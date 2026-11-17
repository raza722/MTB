# MTB brand assets (from the old desktop system)

| File | What it is | Where it came from |
|---|---|---|
| `mtb-crest.png` | The Madrasat-ul-Banat crest (torch, crescent, book; "Inspiring Success & Changing Lives, since 1907"). Used in 51 of the old report designs and as the app logo. | old app `Resources/mtb1.png` and the reports' embedded image `mtb1` |
| `mtb-crest-institute.jpg` | The same crest as stored for Khalid Campus in the old database (`tbl0_01InstituteInfo.InstituteLogo`). | MTB_SchoolSystem |
| `mtb.ico` | The old app's window and taskbar icon. | old app `Resources/mtb.ico` |
| `favicon-legacy.ico` | The old app's favicon. | old app `favicon.ico` |

The old printed heading, from `tbl0_01InstituteInfo.InstituteHeading`, is
**"MTB-Madrasat-ul-Banat Schools and Colleges, Khalid Campus, Sadikabad"** (title "MTB, MADRASAT-UL-BANAT SCHOOLS AND COLLEGES").

Where the apps use them:

- Printouts (staff app): `apps/staff/src/assets/mtb-crest.png` in the shared letterhead (`app/print/letterhead.tsx`).
- Screens: each app's `public/mtb-crest-sm.png` (the crest at 192 px high) on the sign-in page and in the side bar or
  header (`<Crest>` from `@mtb/ui`), and on the parent portal's fee receipt and result card.
- Browser tab and home-screen icons: each app's `public/favicon.ico` (= `mtb.ico`), `favicon-64.png` and
  `apple-touch-icon.png`; the teacher app's `public/icons/icon-192.png`, `icon-512.png` and `icon-maskable-512.png`
  (the crest centred on white, made from `mtb-crest.png`).
