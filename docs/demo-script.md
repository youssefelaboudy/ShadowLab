# Three-minute walkthrough

1. Open the coupon replay. The first four responses agree. Expand summary to see the discount drop from CAD 20 to CAD 10 while subtotal stays at CAD 200.
2. Switch to the verified fix. Point out the per-run cart and item aliases. The comparison checks the same logical objects across fresh databases.
3. Open Run history. Select the missing-currency and HTTP 500 runs. Inspect their first divergent steps and download a report. Visit Trends and Coverage to see exactly which requests generated the evidence.
4. Run the CLI from a clean checkout with `npm ci` and `npm run demo`. Inspect the two artifact paths printed by the command. Explain why an intentional regression returns exit 1 through the replay command and an invalid fixture returns exit 2.
5. Run the quantity-before-coupon control. With that ordering both revisions return CAD 180. Finish with the CI jobs that exercise the Docker boundary, real object storage, worker recovery and browser interaction.
