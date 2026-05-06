#!/usr/bin/env python3
"""Integration tests for fledge-plugin-memory.

Requires: AlgoKit localnet running (algod, kmd, indexer on default ports).
Run from a tmp project dir; the test creates its own identity, exercises
each tier, and tears down at exit. Tier reads/writes go to real algod +
indexer, so allow ~30s per save+recall cycle for indexer to catch up.

Run: python3 test/integration.py
Skip: SKIP_INTEGRATION=1 python3 test/integration.py
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parent.parent
BIN = PLUGIN_DIR / "bin" / "fledge-memory"


def localnet_up() -> bool:
    for port in (4001, 4002, 8980):
        s = socket.socket()
        s.settimeout(0.5)
        try:
            s.connect(("localhost", port))
            s.close()
        except Exception:
            return False
    return True


class Runner:
    def __init__(self, work: Path):
        self.work = work
        self._store_dir = work / ".fledge" / "_test_store"
        self._store_dir.mkdir(parents=True, exist_ok=True)

    def run(self, args: list[str]) -> str:
        captured: list[str] = []
        proc = subprocess.Popen(
            [str(BIN)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1,
        )
        assert proc.stdin and proc.stdout
        init = {
            "type": "init", "version": "fledge-v1",
            "project": {"root": str(self.work), "name": "t"},
            "plugin": {"dir": str(PLUGIN_DIR), "name": "fledge-plugin-memory"},
            "command": "memory", "args": args,
        }
        proc.stdin.write(json.dumps(init) + "\n"); proc.stdin.flush()
        for line in proc.stdout:
            line = line.rstrip("\n")
            if not line: continue
            try: msg = json.loads(line)
            except json.JSONDecodeError:
                captured.append(f"[malformed] {line}"); continue
            mtype = msg.get("type")
            if mtype == "output": captured.append(msg.get("text", ""))
            elif mtype == "log":
                captured.append(f"[{msg.get('level','log')}] {msg.get('message','')}")
            elif mtype == "exec":
                cmd = msg["command"]; cwd = msg.get("cwd") or str(self.work)
                r = subprocess.run(["bash", "-c", cmd], cwd=cwd,
                                   capture_output=True, text=True)
                resp = {"type": "response", "id": msg["id"],
                        "value": {"code": r.returncode,
                                  "stdout": r.stdout, "stderr": r.stderr}}
                proc.stdin.write(json.dumps(resp) + "\n"); proc.stdin.flush()
            elif mtype == "load":
                key = msg["key"]; f = self._store_dir / key
                val = f.read_text() if f.exists() else None
                resp = {"type": "response", "id": msg["id"], "value": val}
                proc.stdin.write(json.dumps(resp) + "\n"); proc.stdin.flush()
            elif mtype == "store":
                (self._store_dir / msg["key"]).write_text(msg.get("value", ""))
            elif mtype == "prompt":
                resp = {"type": "response", "id": msg["id"],
                        "value": msg.get("default", "")}
                proc.stdin.write(json.dumps(resp) + "\n"); proc.stdin.flush()
        proc.wait(timeout=120)
        return "\n".join(captured)


passed = 0
failed = 0


def assert_in(name, output, needle):
    global passed, failed
    if needle in output:
        print(f"  ok {name}"); passed += 1
    else:
        print(f"  FAIL {name}")
        print(f"       expected: {needle!r}")
        for ln in output.splitlines(): print(f"         {ln}")
        failed += 1


def assert_not_in(name, output, needle):
    global passed, failed
    if needle not in output:
        print(f"  ok {name}"); passed += 1
    else:
        print(f"  FAIL {name} (unexpected {needle!r} in output)"); failed += 1


def main() -> int:
    if os.environ.get("SKIP_INTEGRATION"):
        print("skipped (SKIP_INTEGRATION=1)"); return 0
    if not localnet_up():
        print("skipped — localnet not running (algod:4001 / kmd:4002 / indexer:8980 unreachable)")
        print("  start with: algokit localnet start")
        return 0

    work = Path(tempfile.mkdtemp(prefix="fledge-memory-test."))
    try:
        (work / ".fledge").mkdir()
        r = Runner(work)

        out = r.run(["identity", "--json"])
        assert_in("identity creates", out, '"address":')

        # Ephemeral round trip — needs SQL plugin too. We mock via shell
        # `cat` etc — actually the plugin shells out to fledge sql which
        # we don't have here. Skip ephemeral tier for this integration
        # test; it's covered by the smoke test in the parent project.

        # Mutable: save, recall, save again, recall — the ordering bug.
        out = r.run(["save", "--key", "role", "--value", "v1",
                     "--tier", "mutable", "--json"])
        assert_in("mutable save v1", out, '"tier":"mutable"')

        out = r.run(["recall", "--key", "role", "--tier", "mutable", "--json"])
        assert_in("mutable recall v1", out, '"value":"v1"')

        out = r.run(["save", "--key", "role", "--value", "v2",
                     "--tier", "mutable", "--json"])
        assert_in("mutable save v2 (same ASA)", out, '"tier":"mutable"')

        # Mutable tier is eventually consistent: a recall right after an
        # update can return the previous value until the indexer catches
        # up (~5-15s on localnet, longer on testnet). The plugin retries
        # internally, but for a deterministic test we also sleep here.
        time.sleep(15)
        out = r.run(["recall", "--key", "role", "--tier", "mutable", "--json"])
        assert_in("mutable recall returns v2 (NOT v1)", out, '"value":"v2"')

        # Permanent: save, recall, delete (tombstone), recall.
        out = r.run(["save", "--key", "born", "--value", "2026-01-15",
                     "--tier", "permanent", "--json"])
        assert_in("permanent save", out, '"tier":"permanent"')
        time.sleep(5)
        out = r.run(["recall", "--key", "born", "--tier", "permanent", "--json"])
        assert_in("permanent recall", out, '"value":"2026-01-15"')

        out = r.run(["delete", "--key", "born", "--tier", "permanent", "--json"])
        assert_in("permanent delete (tombstone)", out, '"tombstoneTxid"')
        time.sleep(8)
        out = r.run(["recall", "--key", "born", "--tier", "permanent", "--json"])
        assert_in("permanent recall after delete returns not_found",
                  out, '"error":"not_found"')

        # Cross-tier fallthrough: save permanent, recall WITHOUT --tier.
        out = r.run(["save", "--key", "fav", "--value", "blue",
                     "--tier", "permanent", "--json"])
        assert_in("permanent save fav", out, '"tier":"permanent"')
        time.sleep(5)
        out = r.run(["recall", "--key", "fav", "--json"])
        assert_in("recall without --tier finds permanent", out, '"value":"blue"')

        # Bad key validation.
        out = r.run(["save", "--key", "bad key with spaces",
                     "--value", "v", "--tier", "mutable", "--json"])
        assert_in("invalid key rejected", out, "Invalid key")

    finally:
        shutil.rmtree(work, ignore_errors=True)

    print()
    print(f"tests: {passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
