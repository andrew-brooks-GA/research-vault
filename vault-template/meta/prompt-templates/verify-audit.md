# Prompt: Audit inferred-stable entries

Periodically challenge entries verified only via `inferred-stable`.

1. List entries whose latest verification method is `inferred-stable`.
2. For a sample, challenge the `volatility: stable` classification: is this really fundamentals, or did it creep into `fast`/`slow` territory?
3. If mis-tiered: re-tier `volatility` (a metadata correction, update in place) and re-verify with a stronger method, or supersede if the claim is now wrong.
4. `inferred-stable` is the weakest method — treat a vault that leans on it heavily as under-verified.
