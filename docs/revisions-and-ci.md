# Compare actual commits and gate a pull request

From a trusted ShadowLab checkout, install dependencies with `npm ci`. Run the command below to archive each Git reference independently, install that revision’s production dependencies, start each revision’s API on a fresh loopback port and replay the saved scenario. Both references must contain the fixture-checksum handshake. Ports are allocated by the OS and child processes and temporary checkouts are cleaned up at the end.

```sh
node packages/cli/main.ts revisions --baseline-ref demo/baseline-v2 --candidate-ref demo/stale-v2 --scenario scenarios/coupon-quantity.yaml --out artifacts/git-comparison
```

The demo refs contain distinct implementations of the summary calculation. CLI output uses exit 1 for the seeded defect. The JSON and Markdown reports include the independent SHAs. Comparing the baseline ref to itself provides a passing control. The parser also accepts JSON files in the original concise format.

Install the command locally with `npm link` after `npm ci` to use the short form.

```sh
shadowlab scenario validate scenarios/coupon-quantity.yaml
shadowlab replay --scenario scenarios/coupon-quantity.yaml --baseline http://127.0.0.1:4101 --candidate http://127.0.0.1:4102 --fixtures fixtures/carts-basic-v1 --targets config/targets.json --out artifacts/run-002
shadowlab report artifacts/run-002 --format markdown
```

The targets file pins both test-mode loopback origins. A fixture file must match the packaged manifest and the manifest served by each target. Start the two target processes before using the replay subcommand. The one-command demo starts them for you.

## Reusable Action

The consumer workflow starts the test targets before invoking this composite action. Use an immutable commit SHA when pinning the action in another repository. A product difference emits GitHub error annotations on the scenario file and fails the step. Infrastructure errors use exit 2. A following upload step can retain artifacts on failure.

```yaml
- uses: youssefelaboudy/ShadowLab@main
  with:
    scenario: scenarios/coupon-quantity.yaml
    targets: config/targets.json
    out: artifacts/pr-replay
- if: always()
  uses: actions/upload-artifact@v4
  with:
    name: replay-report
    path: artifacts/pr-replay
    retention-days: 14
```

The dedicated consumer CI job exercises the same action against a failing case and a passing control. Native GitHub annotations are generated from the first and subsequent divergent steps without a write token.
