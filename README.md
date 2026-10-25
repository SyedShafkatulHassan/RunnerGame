# Shafkat Runner — endless rooftop runner

A front-end-only browser game, built with `<canvas>` and plain JavaScript. It has no backend, no build step, no frameworks, and no image or audio files.

You play as Bolt the robot, who runs across neon rooftops on his own. You tap or press Space to jump: hold for a higher jump, and tap again in mid-air for a double jump. You jump over crates, vents and gaps, run under drones, and collect energy orbs. The game speeds up as you go. Your best score is saved in `localStorage`.

**Difficulty levels:** Easy, Medium and Hard, chosen on the start screen. They apply to both modes, are remembered, and keep separate best scores. Edit the `LEVELS` table at the top of `game.js` to tune start speed, top speed, acceleration, how soon each obstacle appears (`*At`), and the reaction window after each landing (`react`).

**2-player mode** (same device): the screen splits into two lanes. Player 1 presses W or taps the top half, and Player 2 presses ↑ or taps the bottom half. Both run the same seeded course, and the higher score wins. There is a 3-second countdown, a winner screen, and a match tally for the session. There's also a pause button (which also triggers automatically when the tab is hidden), a mute toggle, and a share button for your score.

## Files

| File | What it is |
|---|---|
| `index.html` | Game page |
| `style.css` | Styles |
| `game.js` | Game engine, level generator, drawing, input and sound |
| `how-to-play.html`, `about.html`, `privacy.html` | Content pages, needed for AdSense |
| `favicon.svg`, `robots.txt` | Icon and search-engine rules |

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. In Vercel, choose **Add New → Project**, import the repository, and set **Framework: Other** with no build command.
3. Click **Deploy**.

To test locally, run `python3 -m http.server 8000` and open http://localhost:8000.

## Staying within the rules

**Copyright and trademarks**
- The character, art, sounds and name are original. Every graphic is drawn in code and every sound is synthesised, so there are no third-party assets to license.
- No fonts are bundled or downloaded: text uses the fonts already installed on the player's device.
- Don't add sprites, music, fonts or sound effects from the internet. Keep everything drawn or generated in code.
- Before you invest in branding, search the name "Shafkat Runner" on the USPTO trademark search (tmsearch.uspto.gov) and the app stores. If it's taken, rename it: change the logo text in each HTML file and the `<title>` tags.
- Describe the game on its own terms; don't compare it to other named games in titles or ads.

**Google AdSense**
- Put ads **below** the game, never inside or overlapping the play area. An ad next to the tap zone causes accidental clicks, which is a policy violation and can get your account banned.
- Never ask or encourage people to click ads.
- Keep the Privacy page live and linked from every page. It already mentions Google's advertising cookies.
- For visitors from the EU/UK, AdSense requires a certified consent (cookie) banner. Enable Google's own consent message under **AdSense → Privacy & messaging**.
- The game is aimed at a general audience. If you market it specifically to children, US COPPA rules apply and ads must be treated as child-directed, so don't do that unless you set that up properly.

**Game portals (CrazyGames, Poki, itch.io)**
- For CrazyGames or Poki, remove the AdSense code from the copy you upload. Those portals require their own SDK for ads, and you earn through their revenue share.
- Read each portal's submission requirements before uploading.

## Tuning

All the gameplay numbers are at the top of `game.js`: gravity, jump strength, start and maximum speed, acceleration, and so on.

For automated testing only, open the page with `?debug=1` to expose test hooks.
