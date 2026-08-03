# VoiceOver test script

Manual screen-reader pass for the Transcribe app. Run on macOS with **VoiceOver** (toggle: ⌘F5). Key VO commands: **VO = Control+Option**. Navigate with **VO+→ / VO+←**, headings with **VO+U** (rotor), interact with **VO+Space**.

Start the app: `npm run dev`, open in Safari (best VO support).

| # | Where | Action | Expected announcement |
|---|-------|--------|-----------------------|
| 1 | Page load | Tab once | "Skip to main content, link" — Enter jumps focus into `main` |
| 2 | Connect gate | Open rotor → Landmarks | banner, main listed |
| 3 | Connect gate | Rotor → Headings | one **heading level 1: "Tools"** |
| 4 | Connect gate | VO to the tool | "Transcribe, Turn audio into captions, button" |
| 5 | Connect gate | Activate, wait ~2s | error announces automatically: "Connection failed, Couldn't reach the transcription server…" (role=alert) |
| 6 | After connect | Rotor → Landmarks | banner, **navigation "Views"**, main, **navigation "Progress"**, contentinfo |
| 7 | Upload | Rotor → Headings | single **h1 "Upload audio"** |
| 8 | Step indicator | VO through the Progress nav | "Select files, current step" / "Process, not started" / "Review, not started"; current item exposes **aria-current** |
| 9 | Upload | VO to dropzone | "Upload audio files — drag and drop, or activate to browse, button" |
| 10 | Selected file | after choosing a file, VO to badge / remove | badge reads **"Ready"** (not just a color); remove reads **"Remove <filename>, button"** |
| 11 | Process step | while a file transcribes | progress exposed as **progress indicator** with a value (e.g. "45%"), labelled "Transcribing <filename>" |
| 12 | Process step | when all finish | status line auto-announces: "All files finished — transcripts saved to history…" (aria-live polite) |
| 13 | Process step | on the "fail" file | error auto-announces (role=alert) |
| 14 | History | open History | h1 "Job history"; each row's status reads **"Done"/"Failed"** as text |
| 15 | Editor | open a transcript | landmark **article**; h1 = file name; video block is **skipped** by VO (decorative, aria-hidden) |
| 16 | Editor | VO to a segment | "Edit transcript at 0:07, edit text" (role=textbox, multiline) |
| 17 | Editor | segment with red words | after the text, VO reads **"Low-confidence words to verify: extended, quiet."** |
| 18 | Idle dialog | leave idle ~14 min (or trigger) | dialog announces on open (alertdialog): title "Still working?" + body; **focus is trapped**; **Esc** = "Keep working" and returns focus |
| 19 | Back-to-Tools modal | click "← Back to Tools" | dialog "Leave transcription?"; Tab cycles only its two buttons; **Esc** closes and restores focus to the trigger |

**Report back:** any item where VO stays silent, reads only a color, announces the wrong role, or lets focus escape a dialog. I'll fix those.

## Already verified automatically (Playwright + accessibility tree)
- Landmarks present on every screen (banner / nav "Views" / nav "Progress" / main / contentinfo / article).
- Exactly one `<h1>` per screen.
- `role=alert` on connect + processing errors; `role=status aria-live=polite` on the completion line.
- `role=progressbar` with `aria-valuenow/min/max` + label during processing.
- Step `aria-current="step"` + `.sr-only` state text; remove buttons labelled.
- Both modals: `role=dialog/alertdialog`, `aria-modal`, `aria-labelledby`/`aria-describedby`, focus trap, Tab cycling, Escape, focus restoration.
- WCAG AA contrast (≥4.5:1) on muted text, brand links, and all five status badges.
