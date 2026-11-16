# Keep replay state separate from history

The CLI allocates a fresh SQLite database per lease, including when two requests hit the same demo process. PostgreSQL owns the distributed queue and cross-run history because workers need transactional claims, fencing and durable results. Object storage holds checksummed reports. A transactional outbox makes upload retries safe after a process or storage failure.

The two Git-ref command uses separate archived checkouts and dependencies. The demo-mode switch is convenient for synthetic benchmarks. Comparing independently launched Git revisions tests the code that each SHA actually contains.

The example API and suite use Node's HTTP and test modules. Playwright verifies the live browser workflow and its HTTP download contract. The blueprint lists web and test frameworks as suggested stack choices. The externally visible contracts are covered by the same integration tests.
