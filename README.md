# SWU TCC

**Star Wars Unlimited Top Cut Calculator.** Paste your Melee.gg tournament
link, pick your name, and see whether you can intentionally draw (ID) your
last round, or need to win, and still make top cut.

Live at **https://swu-tcc.win**.

## How it works

1. The site reads the tournament's public standings and pairings from
   Melee.gg (through a small caching proxy).
2. It rebuilds every player's record and tiebreakers (OMW%, TGW%, OGW%) from
   the match results.
3. For the final round it predicts or reads the pairings (the last round of
   an event with a top cut is paired 1 v 2, 3 v 4, ...), then works through
   the possible results at the other tables to see where each of your
   outcomes (win, draw, loss) lands you.

Every percentage comes with what it assumes. The site only says LOCKED or
100% when that is mathematically certain.

## Development

Requires Node 26 (LTS).

```sh
npm install
npm run check   # types and tests
npm run dev -w apps/web
```

See [CLAUDE.md](CLAUDE.md) for the layout, [docs/free-tier.md](docs/free-tier.md)
for hosting limits, and [docs/research](docs/research) for the Melee.gg API and
SWU tournament rules.

## License

The code is released under the [MIT License](LICENSE). The `fixtures/`
folder holds pseudonymized Melee.gg tournament data and the `docs/brand/`
assets (logos, icons, design language); neither is covered by that license.
Star Wars: Unlimited trademarks belong to Lucasfilm Ltd. See also the site's
[privacy page](https://swu-tcc.win/privacy).

## Legal

SWU TCC is an unofficial fan-made tool. Not affiliated with or endorsed by
Fantasy Flight Games, Lucasfilm or Disney. Star Wars: Unlimited © & ™
Lucasfilm Ltd. Tournament data comes from Melee.gg.
