# Terms of Service

This is a self-hosted instance of Stone Soup. There is no service provider here to make terms with — you deployed the software, or someone did on your behalf, and you (or they) operate it. This document states what the AGPL-3.0 license means for you as the operator, and the one behavior that carries over from the hosted deal even here: the golden-set contribution default.

## The label-contribution default

Self-hosted deployments ship with golden-set contribution **on by default**, clearly disclosed here rather than left to a settings page nobody reads: the same anonymized labeling contribution design described at [/data-promise](/data-promise) applies to this instance too, unless you turn it off. **This submission path does not exist in this codebase yet** *(design — not yet built; see docs/privacy-claims.md)* — until it is built, no label is actually contributed by any path. This is disclosed, not hidden, because pretending otherwise in an open-source project would be theatre — anyone can read the source and see the default.

To turn it off, set this instance's `GOLDEN_SET_CONTRIBUTION` configuration value to `"off"`. That variable is real — it is in this instance's `wrangler.jsonc` — but no code reads it yet *(design — not yet built; see docs/privacy-claims.md)*, because the submission path it would switch off does not exist. See [/data-promise](/data-promise) for exactly what is and is not included when it is on.

## License and warranty

Stone Soup's source code is licensed under the GNU Affero General Public License, version 3.0 (AGPL-3.0). You may run, modify, and redistribute it under that license's terms, including its requirement that anyone you offer a modified version of this software to as a network service can obtain the corresponding source. The software is provided **without warranty of any kind**, to the fullest extent the law where you are permits — see the AGPL-3.0 text for the full disclaimer.

## Operating this instance

As the operator of a self-hosted instance, you decide who may use it and what they may do with it, subject to the AGPL-3.0 license terms above. This document was last revised on 2026-09-10.
