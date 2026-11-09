# Generated rounds

`pnpm evals:generate --round <name> --count 10` writes a round of generated intents here as eval cases
(`<round>/cases/*.yaml`, plus `round.yaml` with the seed and briefs). Run a round with
`pnpm evals --cases evals/propose/generated/<round>/cases --implement`, then `pnpm evals:gaps <run dir>`
ranks what the agents could not express. Rounds are not committed; the seed in `round.yaml` reproduces the
briefs, and the intents can be regenerated from them.
