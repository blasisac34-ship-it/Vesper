# Vesper — Artist Onboarding & Mix Artwork Update

## Included
- Account creation is now a two-step flow: account details first, then artist selection before account creation completes. At least one artist is required for new accounts; guest listening and existing-account sign-in are unchanged.
- Artist onboarding includes a broad, curated starter list across hip-hop/rap, R&B/soul, pop, alternative/indie, rock/metal, Latin, Afrobeats/Amapiano, K-pop, electronic/dance, country/folk, and jazz/instrumental. The list is ordered roughly from more widely popular to more niche within each genre, and artist search lets people find artists outside the starter list.
- Selected artists are saved to the user's followed-artist library after account creation.
- Followed artists now influence recommendation scoring and can seed Daily Mixes for accounts that have not listened to anything yet.
- Home Daily Mix tiles now use available track artwork and update to a 2×2 collage of covers from the mix's first tracks. If artwork is unavailable, the app's existing colored fallback remains.
- Artist-by-name lookup returns artist metadata as well as the artist ID, so the onboarding flow can save cover artwork when available.
- Service worker shell cache bumped to v7 so the old cached Lyrics translation controls should be cleared on refresh; the current Lyrics Pro source has no Translate/language-selector UI.

## Checks
- JavaScript syntax checks passed for changed files.
- `npm test`: 14 tests passed.
- ZIP integrity check passed.
- Live browser onboarding and live provider lookups still need to be verified on the user's Mac.
