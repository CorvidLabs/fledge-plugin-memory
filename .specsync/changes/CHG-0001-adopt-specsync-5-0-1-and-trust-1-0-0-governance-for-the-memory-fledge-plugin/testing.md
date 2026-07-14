---
change: CHG-0001-adopt-specsync-5-0-1-and-trust-1-0-0-governance-for-the-memory-fledge-plugin
artifact: testing
---

# Testing

Local acceptance requires the five-step Fledge lane, all 29 encryption/chunking/permanent tests, strict 100% coverage, four integrations, healthy Trust doctor, and a clean diff.

The tier-specific test suites provide verification evidence for `REQ-memory-001` across ephemeral, persistent, and permanent storage.

Hosted acceptance requires the new `trust` job and existing Bun test workflow to pass while standalone Atlas and Pages remain independent. Live localnet integration remains separately credentialed and environment-dependent.
