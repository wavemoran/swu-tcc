# Security policy

## Reporting a vulnerability

Please report security problems **privately**. Do not open a public issue.

1. Go to the [Security tab](https://github.com/wavemoran/swu-tcc/security) of this repository.
2. Choose **Report a vulnerability** and fill in the form.

Include what you found, how to reproduce it, and which version you tested.
You will get a reply as soon as the maintainer can read it. Please give us a
reasonable time to fix the problem before you share it publicly.

## Supported versions

Only the latest release is supported. Please update to it before reporting.

## What counts

The site has a small server part: a Cloudflare Worker that fetches public
tournament data from Melee.gg and caches it. The most likely problems are in
that proxy (for example making it fetch something other than Melee.gg
tournament data), in how the site displays data it gets from Melee.gg, or in
the build and deploy process. Report anything you think could harm a visitor.
