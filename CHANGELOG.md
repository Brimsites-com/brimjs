# Changelog

What changed in Brim.js, newest first. Since 1.0 the versions are semantic: only a major version may break the API of
components and config, and says so here under **Changed**; a minor version adds, a patch version fixes. Database
migrations are append-only.

## 2.0.0

### Added

- **The fields every site needs, under the same names everywhere.** A content type with a `component` has a
  `description` (`textarea`) and an `image`, as every type already had `author` and `tags`; `description: false` and
  `image: false` leave them out, and a field of that name in `fields` takes its place with a label of its own
  (`{ name: "description", label: "Summary", type: "textarea", required: true }`). `<Seo>` reads the item's title,
  description, image and author by itself on its page, so a layout's `title` and `description` can be left out there.
- **`article: true`** on a content type, for news and blog posts: a `published` date, filled in the day an item is
  first published, and schema.org `Article` data on each item's page (headline, description, picture, authors with
  their pages, dates, the site as publisher), with `og:type` `article`. Only what the item says is written: no date of
  creation or last save, no date still to come, no site-wide description or picture. A `modified` date field, when
  declared, is the date of the last revision.
- **Authors kept as a vocabulary** are named by their title in the page's language, each on their own, with a link to
  their page or to their first `url` field; a private one is not named. RSS feeds name authors (`dc:creator`).
- `max-image-preview:large` in `<meta name="robots">` on every page search engines may list.
- `brim check --content` warns about published items with no description, image or date for search engines
  (`search-empty`), and about fields that look meant for them but are not given to them (`search-fields`).

### Changed

- **Types with a `component` show two more fields**, `description` and `image`, and `Listing` cards, menus, feeds and
  shared links read those by default rather than the first text or image field declared. A site whose fields have
  other names renames them when it updates, in its templates and in the values it has saved (Brim does not move
  them), or says `description: false, image: false` to stay as it was.
- `<meta name="author">` of an author picked from a vocabulary or a `select` is the name shown, no longer the saved
  slug or value.

### Fixed

- `item.data.author` (and any field of a name Brim adds) has the type the site declares; a `multiple` reference was
  typed as `string & string[]`.

## 1.0.0

### Added

- **Forms take files from visitors**: a field of type `file` (`accept: ["pdf", "jpg", "png", "webp", "gif"]`,
  `multiple`), which the owner adds in the side panel like any other field. A file is recognised by its bytes, never
  by its name (no SVG, HTML, archives or programs, whatever a field says); 8 MB a file, 5 files and 10 MB a message,
  30 MB a visitor and 500 MB a site a day; stored only after the message passed every check, under a generated name,
  sealed with a key of the site's database, outside everything the site serves. Only a signed-in owner or editor
  downloads one (`GET /admin/api/responses/<id>/files/<file id>`, always an attachment, never cached); writers
  cannot. The owner's email links to each file and attaches none; `brim_list_form_responses` lists name, type and
  size. Files are deleted with their message. See "Files from visitors" in the README.
- **A confirmation email for the visitor**, off until the owner turns it on per form (**Confirmation Email** in the
  side panel: the email field, a subject, a message), or the code starts it on (`confirmationEmail` in `defineForm`).
  One email to the one address of the chosen email field, only for a message that was kept, without repeating what
  the visitor typed unless _Include the visitor's answers_ is on; 3 a day to one address, 10 a day from one visitor,
  200 a day on the site, counted apart from the owners' emails. "Reply" goes to the site. `src/emails.ts` gains a
  `confirmation` template, previewed at `/admin/api/emails/confirmation`. It is sent the way form emails are, as the
  site (its name as the sender).
- **For hosts.** A site that keeps uploads in a storage (`media.storage`) takes files from visitors only once it has
  a private storage: `BRIM_PRIVATE_STORAGE_URL` and `BRIM_PRIVATE_STORAGE_TOKEN` (or `forms.files.storage`), asked
  for `PUT`, `GET` and `DELETE <url>/form-files/<message id>/<file id>`, where nothing may be public. Without it such
  a site's forms leave file fields out, and `/admin/api/info` lists no `form-files` capability. A site on its own
  disk keeps them in `form-files/` beside its database, which a host that backs up the database should back up too.
- Database schema version 14: `brim_form_responses` gains the column `files` (the list of a message's files; their
  bytes are not in the database). A host that keeps its own copy of the schema adds it.
- **`priority` on `Image`**: the picture a visitor sees first is loaded at once and ahead of the others
  (`loading="eager"`, `fetchpriority="high"`), with Brim's frame or `bare`. Every other image still waits until it
  is scrolled near.
- **`brim check` warns about `<Image>` without `sizes`** (`image-sizes`, once per file): the browser takes such a
  picture for the page's width and downloads a copy that wide.
- **A gallery's pictures open full screen, as a slideshow.** A click on a picture of a `Gallery`, drawn by Brim or by
  the site, opens it over the whole page; buttons, arrow keys and a swipe go through the gallery, and Escape, the
  button or a click beside the picture closes it. It is on unless the code says `lightbox={false}` or the owner
  switches **Open full screen** off; a picture with a link, or inside one, stays a link. `labels` says the buttons in
  the page's language. A site that opens its pictures with a script of its own takes one of the two out.
- **`MobileMenu`**: a menu that opens over the whole page from a button, for phones. Brim keeps how it opens and
  closes (the browser's own popover: Escape, the button, a click outside or following a link closes it, and the page
  does not scroll behind it); the links inside, their look and the width from which it shows are the site's. A header
  with a `backdrop-filter` or a `transform` cannot cut it, as it does a `position: fixed` panel. New sites from
  `create-brim` have one in their header.

### Changed

- **Brim.js is the public npm package `brimjs`**, and `create-brim` is on npm with it. `create-brim` and `brim init`
  write `"brimjs": "^<version>"` instead of `npm:@brimsites/brimjs@…`. A site on the private package changes that one
  line in its `package.json`.
- **`npx brimjs init` writes the version it came from.** The published command wrote `^0.0.0`.
- **The server makes copies of the pictures in `public/` with sharp only when asked.** It did so whenever sharp could
  be found; a site behind a CDN that resizes needs neither the package nor the work. A site with no such CDN that
  wants them sets `brim({ media: { sharp: true } })` or `BRIM_MEDIA_SHARP=1` and depends on `sharp` itself
  (`npm install sharp`); without it those pictures are now sent as they were saved. `brim check` warns (`no-sharp`)
  when it is asked for and not installed. Nothing changes where the host's CDN makes the copies (`media.siteUrl`
  with `resize`, as on Brimsites).
- **A photo wider than the widest copy is never sent as it was uploaded.** Its `srcset` ended with the upload itself
  (`… 4000w`), which a large screen of double density picked: megabytes, at the camera's quality. It now stops at the
  widest copy (2560 px), which is also its `src`. An image no wider than that is still the widest of its own list.
- **A shared link's picture is a copy 1200 px wide** where the CDN makes copies (`media.resize`), instead of the
  upload at full size: `og:image` and `twitter:image`.

### Fixed

- **Every email's subject and sender's name are one clean line**, and every recipient one plain address, checked
  where emails leave the site: a line end in a subject written by a template can no longer reach a mail server.
- **A writer no longer sees a visitor's message in the email preview** (`/admin/api/emails/form` showed the newest
  message to anyone signed in; a role that cannot read messages now sees the example).

## 0.1.79

### Fixed

- **Taking consent back deletes the statistics cookies wherever they are.** A Google tag may set them on the domain
  instead of the host name, where they stayed after **Reject**. They are deleted on the host name and on every domain
  above it, and the console says so when a tag shares them with the sites next to this one.

## 0.1.78

### Added

- **Visitor statistics.** `<Analytics>` in the layout and `BRIM_GOOGLE_ANALYTICS_ID` in the server's environment: the
  site asks visitors once and loads Google Analytics 4 only after they accept. Without the variable it draws nothing;
  editors are never counted. `data-cookie-settings` on an element opens the choice again. See `docs/seo-and-pages.md`.

## 0.1.77

### Added

- **Other spellings of the site's name.** `identity.alternateName` (a text or a list) is written in the home page's
  structured data, so search engines know that "AcmeStudio" and "Acme Studio" are the same site.
- **Profiles elsewhere.** `<Seo sameAs={[facebook, instagram]}>` writes the site's social profiles and maps listing in
  the home page's structured data. Take them from Site Settings and they follow what the owner sets; empty ones are
  left out.

## 0.1.76

### Added

- **Account emails.** Adding someone to a site, changing their role and resetting their access email them from the
  site: what changed, what their role allows, the editor's address, a link to choose their own password (for a new
  user and after a reset; it works once and is never used up by link checkers) and the host's sign-in when there is
  one. Sites write them in `src/emails.ts` as `userAdded`, `roleChanged` and `accessReset`; the ones a site leaves out
  are Brim's own. Preview them at `/admin/api/emails/account?kind=added|role|reset`.
- **The users API.** `/admin/api/users` (list, add, change role, remove) and `/admin/api/users/reset`, for owners and
  for a host's dashboard with an owner's token, said in `/admin/api/info` as the capability `users`. Owners have the
  new `users` permission.

## 0.1.75

### Added

- **Up and down for ordered content.** The items of an `ordered` content type have ↑ and ↓ next to their drag handle
  in the content browser: one click moves an item one place, the same as dragging it.

## 0.1.74

### Changed

- **HLS videos start sharp.** A browser's own HLS player (Chrome now has one, like Safari) starts on the first
  quality a stream lists, often the smallest, so the first seconds were blurry. The video block now plays streams
  through hls.js wherever it can, starting on the quality that fits the player as it is drawn and never fetching a
  larger one; an iPhone, which has no MediaSource, keeps its own player.

## 0.1.73

### Fixed

- **Picked choices whose words hold a comma.** A field of several choices kept its picked choices by cutting the
  joined answer at each ", ", so "Warm, natural" became two choices nobody offered and the editor marked none. They
  are kept as they were sent now, and responses saved since 0.1.70 are read back by looking for each whole choice.

## 0.1.72

### Added

- **The email about a message opens that message.** Each response has a link, `/admin/edit?response=<id>`, that
  opens the editor straight on it (its choices shown as the form asked them); a site's email template gets it as
  `email.responseUrl`, next to `responsesUrl`, and Brim's own email has an **Open this message** button.
  `FormStore.save` answers the response's id.

## 0.1.71

### Added

- **Earlier responses get their cards too.** A response sent before answers kept their choices is shown with the
  choices its form offers now, read from the form on its page, when the question is still asked.

## 0.1.70

### Added

- **Responses read back as the form asked them.** An answer to a question with choices keeps every choice the
  question offered (with its icon or photo) and the ones picked (`choices`, `picked` on the answer); in the editor's
  responses, such a question shows its cards, the picked ones marked, one question under the other. Responses sent
  before keep showing their text. The form's signed spec now carries the choices' icons and photos.

## 0.1.69

### Added

- **Videos through the site's MCP.** `brim_start_video_upload` asks the site's video host for a place to upload a
  file and answers the tus address and headers, so an AI agent sends the bytes straight to the host, however large;
  `brim_video_status` says when the video is ready, with its `url` and `posterUrl` for a video element or block;
  `brim_list_videos` lists the videos already on the host.

## 0.1.68

### Added

- **A form's steps in the sidebar.** A form asked in steps lists its steps as an accordion, each holding its title,
  its line and its own questions; steps move up and down, a removed step gives its questions to the one before, and
  **Add step** / **Ask in steps** start new ones. Opening a step shows that step on the page (the form listens for
  `brim:show-step`), and it stays shown while each change draws the page again.

### Changed

- A question keeps its name once it has one: changing its label no longer renames where its answers are kept, nor
  breaks the questions asked after it (`showWhen`). A new question still takes its name from its first label.

## 0.1.67

### Added

- **Fields asked only after an answer.** A field with `showWhen: { field: "city", equals: ["Other"] }` shows once that
  other field has one of those answers (for a field of several choices, one of them ticked); otherwise it is hidden,
  its inputs disabled, and the server neither requires nor keeps it. A field that appears takes the focus, and a form
  with `autoAdvance` waits for it. In the editor: **Ask only when** under each field.
- **Card choices are edited in the sidebar.** A field shown as cards lists its choices one by one, each with its
  words, a line under them, a photo (the editor's image picker) and an icon.

## 0.1.66

### Added

- **A card choice can be a photo.** `{ label, image }` fills the card's top with the picture
  (`.brim-form__choice-image`), for questions answered by pointing at what one likes.
- **Fields of several choices.** The field type `checkboxes` ticks any number of its `options`, as a list or as cards
  (`display: "cards"`); the answer is kept as the choices joined by commas, each checked against the options, and
  `required` asks for at least one. In the editor: **Several choices**.
- **A form can move on by itself.** `<Form autoAdvance>`: in a form asked in steps, a step that asks one single choice
  goes to the next step once it is answered. `brim-form` carries `data-step-number` and `data-steps`, for a
  "3 / 12" in the site's CSS.

## 0.1.65

### Added

- **A form's choices can be cards to click.** A `radio` field with `display: "cards"` shows its choices as boxes
  (`.brim-form__choice`, with `.brim-form__choice-icon`, `-label` and `-description`) instead of a list; the radio stays
  in each box, out of sight, for the keyboard, screen readers and the step's check. A choice can be
  `{ label, icon, description }`: the icon is a picture's address (an SVG of the site, an upload) or a short text such
  as an emoji. The owner switches a field to cards under **Show choices as** in the editor, and a choice keeps its
  icon while its words stay. A site's own form markup gets the choices as `field.choices`. The CSS is only what makes
  the cards work, in `@layer brim`; their look is the site's.

## 0.1.64

### Added

- **Every form asks the visitor's browser for a little work before it sends.** With the token,
  `GET /_brim/forms/token` answers `work` (16): the page's script finds a number that, after the token, gives a
  SHA-256 starting with that many zero bits, while the visitor fills the form in, and sends it as `work`. The server
  checks it with one hash and refuses a submission without it. While the site is being sent many messages (30 tried
  in ten minutes, then 100) new tokens ask for 18, then 20 bits; the token signs its level. `brim-form` carries
  `data-working` meanwhile. Nothing to set up and no third party, on
  every site; a script sending many messages pays for each one. Turnstile and hCaptcha (`forms.captcha`) stay for more. A page
  cached with the previous script cannot send until it is drawn again.

### Removed

- **The editor's AI assistant is removed.** Brim.js no longer has AI: the assistant's button and panel, the routes
  `POST /admin/api/assistant`, `GET /admin/api/assistant/status` and `POST /admin/api/assistant/picture`, the
  `assistant` capability and look in `/admin/api/info`, `BRIM_AI_KEY` (and a host's `BRIM_AI_URL` and
  `BRIM_AI_TOKEN`) and the `@anthropic-ai/sdk` dependency are gone. `brim({ assistant })` is ignored, with a warning
  when the site starts. The site's MCP and the editor's API stay as they are.

## 0.1.63

### Added

- **Uploaded videos can be deleted.** The video block's settings list the videos on the site's video host, each
  with "Use" and "Delete", so a video nobody shows no longer takes up space there. Two optional calls for a
  video host: `GET {url}` (the site's videos, newest first) and `DELETE {url}/{id}`; a host without them answers
  `404`, `405` or `501` and the editor shows no list. API: `GET /admin/api/videos` answers
  `{ supported, videos }`, `DELETE /admin/api/videos/:id` answers `{ deleted: true }`, for the same users as
  uploading.

## 0.1.62

### Added

- **A host can cache pages precisely.** A request that changed what visitors see (drafts saved, a direct change to
  elements, items or pages, their visibility, SEO or password, redirects, site settings, a change taken back, an MCP
  tool call that did one of these) is answered with `X-Brim-Changed: live`, only on success; drafts, reads,
  sign-ins, uploads and private new pages or items never are. `/admin/api/info` lists the capability
  `live-change-header`.
- **Pages declare the query parameters they read**: `/admin/api/info` answers a `query` map (path or `*` pattern →
  names or `"all"`, capability `query-params`) so a host keeps exactly those in its cache key. Brim declares its own
  (`?edit`, the Listing's search, pages and facets, the Search's words), learned per path as pages are drawn and
  kept in the site's database for the build. The site's code declares its own with `readsQuery()` from
  `brimjs/server` or `brim({ query })`; undeclared paths keep every parameter. The build and `brim check` warn
  about code that reads the query without declaring it.

## 0.1.61

### Added

- **Forgot password.** The sign-in form's "Forgot password?" emails a one-time link (an hour) to set a new password,
  through the site's own email setup; the answer is the same for an email with no account, and one address gets at
  most 3 emails an hour. The link uses the site's `site` (or `BRIM_SITE_URL`), never the request's Host. API:
  `POST /admin/api/password/forgot {email}`, `POST /admin/api/password/reset {token, password}`.
- **Change password** in the editor's menu, with the current password (`PUT /admin/api/password {current, password}`).
  Both sign the user out everywhere else; the browser they used stays signed in.
- **Item pages name their translations for search engines** (`hreflang`), each at its own address
  (`/blog/spring` and `/ro/blog/primavara`).
- **An item that changes its address redirects from the old one** (301, in the site's redirects) while it is
  published; a term's page included, as the README promised. A new item at that address takes it back.
- **A seed links translations whose slug differs from their original's**: `"translates": "spring"` on the entry;
  `brim seed --export` writes it, so an export of a site in two languages seeds again.

### Changed

- **A new item whose title another item has gets a number in its address** (`lake-house-2`) instead of being refused.
  An address the person typed is still refused when it is taken.

### Fixed

- **The page's elements can be reached with the keyboard**: Tab moves through them in the editor (only there, never on
  the public page), Enter or Space selects, Escape lets go, F6 moves between the page and the settings panel, and the
  selection is announced to screen readers.
- **Japanese, Chinese and other input methods**: Enter that confirms a candidate no longer adds a line, sends the
  assistant a half-written message or submits a field; Escape while composing no longer leaves the text.
- **Text dragged in, or pasted, from Word, Google Docs or another page comes in clean**: one-line texts get plain text
  (lines joined with a space), rich texts lose Word's markup, colours and links the site would refuse; files dropped on
  the page no longer open in its place.
- **The content browser's filters are written properly** ("Vocabularies", not "Vocabularys").
- **Image fetching checks the address it connects to**, not only the one it checked first: a name that answered a
  public address to the check and a private one to the connection (DNS rebinding) is refused.
- **A listing reads the preview pictures of all its cards at once** (it made one database round trip per card).
- **`brim seed` reads each type once** instead of once per translation.

## 0.1.60

### Security

- **`brim_read_page` asks only this site for a page.** A path like `//evil.example/x` or `/\evil.example/x` made the
  server fetch another host with the caller's token or the editor's session cookie (the assistant has this tool too).
  Such paths are refused, and the page's address must have the site's own origin. The same goes for the small
  pictures the assistant looks at.
- **Image fetching refuses IPv4-mapped and NAT64 addresses written in hex** (`[::ffff:127.0.0.1]` reaches the parser
  as `::ffff:7f00:1`), which got past the check for addresses inside the server's network.
- **A writer cannot read form messages through `GET /emails/form`** (the newest message is in it): it asks for the
  `responses` permission, like `/responses`.
- **Sign-in attempts sent all at once stay within the limit** (10 wrong passwords per 15 minutes per address and per
  email): every attempt is counted before the password is checked, and one that signs in is given back.
- **A writer cannot move a published item through the history**: restoring an older address of a published item asks
  for `publish`, as editing its slug does.
- **An owner's own email server must be a public address**: `localhost`, names without a dot and addresses inside the
  host's network are refused when saved, and the name is checked again once resolved when an email is sent.
- **An MCP batch holds at most 20 requests and runs them one after another** (a 1 MB batch started thousands of tool
  calls at once, and its changes raced each other).

### Fixed

- **Text being typed on the page is never lost.** Opening another page (site map, language, the assistant's "Open"),
  a redraw after a change and Save all save the open text first; Save is on from the first letter typed; leaving or
  reloading the tab warns while typed text, drafts or a save are still on their way. A text whose save failed opens
  again with what was typed.
- **Being signed out keeps the work**: a "Sign in again" dialog opens over the editor, which stays as it is, and the
  change that was refused is sent again once signed in (it used to be lost with the editor).
- **Save (and Cmd+S) waits for every change in progress**, the sidebar field being typed in included, so what was just
  typed is part of what visitors see.
- **The page an editor opens wins over a redraw still loading**: the assistant creating a page and opening it, or a
  setting changed just before picking another page, no longer brings the old page back.
- **The item form asks before leaving with unsaved changes** (Back, Cancel, another language, closing the tab), and the
  page's shortcuts (undo, redo, save) are off while the content browser covers the page.
- **Requests that create something are not sent twice**: the editor sends a request again only when a proxy answered
  that the server could not be reached, and a POST (a new item, a drawn picture, Save) only on 502 or 503, never on a
  timeout the server may have finished.
- **Number boxes take what is typed and check it when you leave them** (typing 24 in a box whose minimum is 10 gave
  10); sliders and the colour picker save once, when you let go, instead of on every move.
- **An item page that changes its address keeps its password and search settings** (both are kept by address, so a
  protected item page turned public when its slug or category changed).
- **An original item deleted and put back from the history is the original of its translations again** (they stayed
  linked to the translation that had taken its place).
- **The sitemap leaves out item pages behind a password, hidden from search engines or with a canonical address
  elsewhere**, as it already did for pages.
- **Redirects from addresses with diacritics work**: `/cafea/ș` written by the owner now matches the `/cafea/%C8%99`
  the browser sends.
- **A database that could not be opened is tried again on the next request** instead of failing every page until the
  server restarts (one network error at start on a remote libSQL database was enough).
- **An upload whose file name or folder header has broken percent-encoding gets an answer** instead of a server error.
- **`brim user add --role editor ana@example.com` works**: the email may come after the options.

### Added

- **Mr Brim looks at pictures before choosing one**: small copies of a few pictures of the media library (the CDN's
  when the site has `media.resize`), at most 6 at a time and 12 in one answer, since each one costs part of the AI
  budget.
- **Mr Brim proposes drawing a picture, and only draws it when the person agrees.** When nothing in the library fits,
  he proposes one: the editor shows the description (which the person may change), what it costs, and Generate or
  No thanks. A drawn picture goes into the media library (the item's folder) and he is told where to use it. Through
  the host only (`POST <BRIM_AI_URL>/v1/images`, within the site's monthly limit); at most 20 a day per person.

### Fixed

- **Mr Brim makes complete items and puts pictures where they belong**: a new item gets every field its type declares
  (summary, dates, SEO title and description, tags, a main picture from the media library with its alt text), and
  pictures of an item go into its image field or as image blocks in its blocks field, not into the page's elements.
- **A step Mr Brim could not do shows why right under it** (it was folded away, and sometimes empty).

### Changed

- **Mr Brim shows what he is doing while he does it**: each step as it starts and ends ("Working · Creating an item ·
  “Lake House”", then "Done", or "Failed" with why), three dots while the model decides the next one, and the current
  step under his name. What he creates (an item with a page, a page) opens in the editor when he is done, with an
  "Open" button beside his answer. The stream gains `thinking`, `tool-done` and `created` events, and `tool` events an
  `id` and a short `detail`.

### Added

- **The editor's assistant can have the site's own name and picture**: `brim({ assistant: { name: "Ana", icon:
  "/ana.svg" } })`. The editor's bar, its panel and the assistant's answers use them; without them it stays Mr Brim.
  An icon must be a file of `public/` or an https address, and a name at most 40 characters, or the site stops at
  start with the reason.

### Fixed

- **Mr Brim's answers show their lists, bold and code** instead of the Markdown signs around them.
- **The editor no longer goes blank when Mr Brim answers.** The panel scrolled to the answer in an effect that
  returned `scrollIntoView()`'s result, which current browsers make a promise. React took it for a cleanup function
  and stopped the editor.

### Changed

- **The site's own `BRIM_AI_KEY` wins over the host's `BRIM_AI_URL`** for Mr Brim: an owner on Brimsites can bring
  their own Anthropic key (and `BRIM_AI_MODEL`) instead of the platform's assistant. Before, the host's address won.

### Fixed

- **Brim.js installs again where packages must be a day old** (pnpm's `minimumReleaseAge`, as Brimsites' servers
  use): 0.1.51 asked for `@anthropic-ai/sdk` 1.12, published the day before. It now accepts 1.11 and later.

### Changed

- **The body of an item with a page is a `blocks` field, in the guides for AI agents** (`brim-convert`, `AGENTS.md`,
  the notes `brimjs init` writes), so the owner adds images, galleries, buttons and videos between its paragraphs.
  They offered `RichText` and `blocks` side by side, and a converted blog kept its articles as rich text, where the
  owner could only write. `richtext` stays for text that should stay text; `brim check` suggests blocks for the rich
  text of a type with pages (`text-only-body`) unless its line says `// text only`.

- **Links are prefetched.** Brim sets Astro's `prefetch` (`prefetchAll`, on hover, focus or touch) unless the site
  sets its own: the next page is fetched as the pointer reaches its link, so it opens at once when clicked. A link
  that should not be fetched ahead takes `data-astro-prefetch="false"`.
- **Brim's CSS is in the `brim` cascade layer.** The CSS of every primitive (form, button, carousel, gallery,
  listing, blocks, text and the rest) is the least that makes it work, and any CSS of the site now wins over it
  whatever its selectors: a site's `input { … }` styles a form's fields, and no rule needs `!important` to beat
  Brim's. A site that relied on Brim's look beating a generic rule of its own sees its own rule now.
- **A form is as wide as its place.** `.brim-form` had `max-width: 40rem`, so a form stopped at 640px in a wider
  column. Its width is the site's, or the owner's in a `blocks` field.

### Fixed

- **Turning languages on no longer hides what the owner saved.** The navbar, footer, shared texts, Site Settings
  and template changes saved without a language were read from a per-language place once `i18n` was set, so they
  disappeared from the pages. They now become the default language's, once, when the server or a build starts
  with languages (unsaved drafts too); a language's own value is never overwritten.
- **Removing an image from a gallery bound to an item's field reaches the item in the editor too.** The image was
  removed from the item, but the editor kept the item as it was before: Page Settings still listed the image, and
  the next change made there brought it back.
- **A form's Notification Email no longer shows in the page.** It went into the page's signed form description,
  which anyone can read in the source; it is now sealed (AES-GCM, with the site's secret) and only the server opens
  it. Pages made before still work.
- **The rate limit table no longer grows without end.** Every form message left a row that was never deleted; rows
  whose window ended over two days ago are now cleared, at most once an hour.
- **The site's daily limit on form messages stops emails, not messages.** Past 300 a day messages are kept for the
  editor and only not emailed, so someone sending from many addresses can no longer stop real visitors' messages for
  the rest of the day; past 5,000 a day they are refused.
- **A class given to `ImageGallery`, `Carousel` or `Blocks` is written once.** It was written twice on the
  element (`class="photos photos"`), beside the block's own class.
- **A fading hero keeps changing when its pictures are wider than it.** A track that does not scroll
  (`overflow: hidden`), whose slides lie in one grid cell, was taken for a scrolling one when a picture's own width
  widened that cell, and its slideshow stuck on the second slide.
- **Pictures of `public/` are not broken where sharp is missing.** Astro's image endpoint needs sharp, which a site
  installed with pnpm (strict node_modules) or without it does not have: every copy answered 500 and the pictures
  showed their alt text. Brim checks once that Astro can load sharp and otherwise sends them as they are.
- **No `getStaticPaths() ignored` warning for the RSS route in a server build.** Like the template route, it is two
  files: the server's makes each feed when asked (`brimjs/rss`), a static build's lists them (`brimjs/rss-static`).
- **The site map follows the site's structure.** Items and groups of an `ordered` type or vocabulary are listed in
  the owner's order, as the site's menus show them, not by title. A type whose address starts with the page of a
  term hangs under that term's group (the catalogs of the ceramics under Ceramică, not beside the products). A group
  with more items than it lists is split again by the first other vocabulary most of its items use (the 771 ceramics
  by their style), and a vocabulary whose terms are all such subgroups opens from there instead of being a branch of
  its own. A new item added in a subgroup starts with the values of both groups.
- **Form emails name the site's address, not the server's.** Behind a proxy (on Brimsites, in a container) the
  subject, the sender's name and the links read `localhost:43967`, the server's own address. They now use the
  address the host gives the site (`BRIM_SITE_URL`), else the one the visitor used (`X-Forwarded-Host`); the test
  email of Site Settings too.
- **A form placed in a template says which page it was sent from.** A product's order form is the same form on every
  product, and the owner could not tell which product a message was about: its page was only in the response's
  id. The email now says "Sent from" with a link to the page, and the editor's responses show it in the list and
  as a link when one is opened.
- **The site's address can come from its host.** Without `site` in astro.config, a build takes `BRIM_SITE_URL`
  (an http or https address), so canonical links, the sitemap, feeds and shared pictures name the address
  visitors use. Brimsites sets it to the site's domain; a site that sets `site` itself keeps it.
- **A field changed from `richtext` to `blocks` keeps what was written.** Each saved text reads as the field's first
  block (on the page, in the editor and when the item is saved), and the server writes it so in the database when
  it starts, with one query per `blocks` field that finds nothing afterwards; the items keep their dates. A site
  changes the type and deploys: no script, no restore. `blocksOf(value)` from `brimjs` reads a field's blocks either
  way, for a table of contents or a reading time.
- **"Choose from site" reaches every image, however many.** The library listed the newest 500, so older images were
  missing from the picker and from its search. `GET /admin/api/media` now answers a page at a time (`next`, then
  `?after=`), searches the whole library by name (`?search=`, any case) and filters a folder (`?folder=`, "" for the
  gallery); the picker asks it as the owner types and brings the next page as the grid scrolls to its end. The MCP's
  `brim_list_media` takes the same `search`, `folder` and `after`.
- **"Choose from site" shows its pictures as cards, and loads only what is on screen.** While the pictures were
  still loading, the grid in the fixed-height dialog sized its rows at 2 px, so the cards lay over each other in
  strips and every picture was in view, so loaded at once: on one site, over a thousand uploads at full size. Rows are
  as tall as their cards now, and `GET /admin/api/media` gives each upload a `thumbnail`, a 320 px copy from the
  site's CDN when `media.resize` is set, which the picker shows.
- **Pictures of the site's own code are no longer sent at full size.** An image in `public/` (`/images/hero.jpg`),
  as the hero, a gallery or a section starts with, gets a `srcset` of WebP copies made by Astro's image endpoint
  (`/_image`, quality 75, never wider than the picture), as uploads get theirs from `media.resize`. On one site the
  home page's hero went from 1.6 MB of JPEGs to about a third of that on a wide screen, and far less on a phone.
  Only on a server; a static build sends them as they are. A host that copies `public/` to its CDN at each deploy
  says where with `media.siteUrl` (`BRIM_MEDIA_SITE_URL`): with `resize`, those pictures then come from the CDN,
  as uploads do.
- **One rule for pictures in the guides for AI agents** (`AGENTS.md`, `brim-convert`, the MCP's instructions, the
  notes `brimjs init` writes). The pictures the design starts with (hero, sections, a gallery the site ships with,
  logo) are files in `public/`, at most 2560 px wide; pictures of items and anything filled in bulk are uploads.
  They said "content pictures go into the media library, not `public/`" and, for a hero, "a starting picture in
  `public/`, then an upload saved as the element's value": half of that looked done, and shipped megabytes.
  `brim check`'s `large-public-image` says so too.
- **The content browser opens at once with many items.** It waited for every type's whole list before showing
  anything, and the editor's API read each list whole from the database: on one site, 1,056 products took 6.5 s on
  Bunny Database, with only "Loading…" and the pages on screen. `GET /admin/api/items` now answers from the list the
  server keeps (read again only where items changed), and the browser shows the types first and each type's items
  as they arrive.
- **A page costs one round trip to the database.** A page read its record, its nodes, the site's redirects and
  passwords, and asked each content type whether its items changed, one query after another: 6 to 12 round trips,
  over a second on a remote database (Bunny Database, Turso) at about 120 ms each. The server now keeps what pages
  read of the content (`brim_nodes`, `brim_pages`, `brim_items`, `brim_meta`, `brim_media`, `brim_drafts`) and asks
  the database one small question per visit: its version, in `brim_changes`, which triggers move forward on every
  write to those tables, by this server or any other process (the CLI, a restore, a second server). The reads a page
  still needs after a change are asked together. Accounts, sessions, rate limits, form responses and the editor's
  API always read the database. `brim_changes` and its triggers are added at start, not as a numbered migration.
- **No `getStaticPaths() ignored` warning in a server build.** The route of template pages and item pages is two
  files now: the server's looks each page up (`brimjs/template-page`), a static build's lists them
  (`brimjs/template-page-static`).
- **`/robots.txt` without `site`.** It was added only with the sitemap, which a build without `site` in
  astro.config left out, so every crawler's request drew the 404 page. A server now answers both with the address
  it was asked at (`X-Forwarded-Host` behind a CDN); a static build still needs `site` for a sitemap.
- **Note for sites that styled forms before 0.1.27:** the fields are inside `.brim-form__fields`, a grid where a
  field's `width: "half"` (set in the side panel) shares a row. A site's own grid on `.brim-form form` sees one
  child and squeezes every field into its first column: drop it and give the fields `width: "half"` instead.

- **A carousel whose slides the site lays one over the other moves.** The script read the shown slide from the
  scroll, so a track that does not scroll stayed on its first slide. It now keeps the slide itself and marks it
  `data-active`, and the site's CSS draws the change: a hero whose pictures fade is one `Carousel` with its slides
  in the side panel, not `Image`s stacked and animated by hand, of which the owner could reach only the top one.
- **A carousel keeps its slides' `z-index` to itself** (`isolation: isolate` on `brim-carousel`): a fade that raises
  the shown slide no longer covers the shade and title a hero lays over the carousel.
- **Item pages and listings no longer read every item of a type each time.** An item's page (`getItem`, and the
  middleware's look for its picture and author) reads that one item by its address, instead of all the type's items
  to keep one: on a remote database with hundreds of items a product page took 15–20 s to start. Whole lists
  (`getItems`, `Listing`, menus `from` a type) stay in the server's memory: one small query tells whether an item
  of the type was added, changed, hidden, moved or removed since, whoever changed it, and then only the items
  edited are read again. The server reads every type once when it starts, and a page asks for the same list or
  the site's settings (`getSiteSettings` in the header, footer and a button) once, however many parts show them.
- **`brim check` no longer takes one item field for two elements** (`duplicate`): the same nodeId on
  `item={item} field="title"` in the two branches of `a ? … : …` is one value, kept in the item.
- **`brim check` no longer takes an example for a contact detail** (`contact-in-code`): a form field's placeholder
  (`placeholder: "https://pinterest.com/..."`) or an address ending in "…" is shown to visitors, not a contact.

### Added

- **Mr Brim, an AI assistant in the editor.** His face in the bar opens a conversation beside the page: it writes new items of the
  site's content types, rewrites texts, translates items into the site's other languages, writes alt texts and uses
  the pictures and videos the person attaches. It acts through the site MCP's tools with the person's role, never
  publishes, deletes or reads form messages, and everything it changes waits in the drafts (items start private).
  On Brimsites it goes through the host (`BRIM_AI_URL`, `BRIM_AI_TOKEN`), which turns it on per site and keeps a
  monthly budget; elsewhere `BRIM_AI_KEY`. `POST /admin/api/assistant` streams its steps; `GET
  /admin/api/assistant/status` says whether it may be used and how much of the budget is spent. Mr Brim is the
  character Brimsites uses for its assistants; he moves while he works.
- **A new site declares its language from the start.** `npm create brim` asks for it (`--lang ro`) and writes
  `i18n: { defaultLocale, locales: [it] }` and `<html lang>`; `brim init` declares it too (`--lang`, else the
  layout's `<html lang>`, else `en`). With one language the editor shows no language menus.
- **Vocabularies in several languages.** A term not translated into the page's language yet shows in its original
  language (in `getReferences`, a listing's filters and the new `getTerms`) instead of missing, or showing its bare
  slug. A term's translations keep its slug: changing it on a translation is refused, and changing it on the
  original moves its translations and the items pointing at it, also when it is saved from the editor's drafts
  (which before left the items pointing at the old slug).
- **Choices in several languages**: a `select` option takes `labels: { en: "Glossy" }`, shown on the pages and in a
  listing's filters of that language.
- **`brim_translate_item`** in the site MCP translates an item into another language (a private copy linked to it,
  with its slug), and `brim_list_items` takes `locale`.
- **Form emails by role.** Site Settings › Form emails has a box per role: the site's owners (on by default) and
  its editors. Writers are never emailed form messages, since their role cannot read them in the editor. The API
  takes `notifyRoles`; settings saved with `notifyOwners`, and clients that still send it, keep working.
- **Working on a live site, the agent offers to download its content first.** The hosting guide, the starter's
  `AGENTS.md` and the notes `brimjs init` writes tell an AI agent starting work on a site that is online to ask once
  whether to bring its live content onto the computer (`brimsites export`, the local `.brim` kept outside the
  project first), so it works on the site as visitors see it; the hosting guide has the steps ("Working on the
  site with its live content").
- **After a first deploy, the agent offers to save the live site's MCP.** The hosting guide, the starter's
  `AGENTS.md` and the notes `brimjs init` writes tell an AI agent to ask once, after a deploy that works, whether to
  add the site's MCP (`brimsites tokens create`, then `claude mcp add`), so it can change the live content without
  the editor; the hosting guide has a section on it ("Editing the live site from an AI agent").
- **Forms in Site Settings.** A Forms section lists the site's forms that visitors wrote through, with how many
  messages and the newest's day; one opens its messages in the content browser, where Form responses now has a
  filter per form.
- **A challenge on forms: `forms.captcha`.** `brim({ forms: { captcha: { provider: "turnstile", siteKey } } })`
  (or `"hcaptcha"`) shows the provider's widget on every `Form` and `Newsletter`, and the server asks the provider
  about each message before keeping it. The secret key is read from `BRIM_CAPTCHA_SECRET`; without it such forms
  refuse every message rather than take one unchecked.
- **An item's `gallery` field is edited like a gallery block.** In the item form and Page Settings it has the same
  cards as a gallery or carousel block's images, each with its picture, moved and removed from its row and opened to
  change the image and its description, instead of a plain list.
- **The side panel and the page preview are resized by dragging.** The edge between the page and the side panel
  makes the panel wider or narrower (kept in the browser; a double click gives it its own width back), and handles
  on both sides of the page preview show the page at any width between a phone and the whole window, with its width
  above it and a Reset. The device buttons give the page their own width again. Both handles also move with the
  arrow keys.
- **What the owner saved on a page, at hand before changing its code.** `npx brim content [path]` (and `--all` for
  every place with saved content), `GET /admin/api/nodes?path=` and the MCP's `brim_page_content` list each saved
  element of a page, of its template when it is an item's page, and of the whole site, with its kind and value.
  On Brimsites: `brimsites content <site> [path]`. A nodeId renamed or removed in code drops what was saved for it:
  this says what that would be.
- **The site writes its emails: `src/emails.ts`.** `export const emails = defineEmails({ form: (email) => ({ subject,
  html }) })` writes the owner's email for a form message from what was sent (form, site, the page it came from,
  answers, the visitor's address), with `html`, which escapes every value so what a visitor typed never becomes
  markup. What a template leaves out is Brim's own, and a template that throws sends Brim's own: no message is
  lost. `/admin/api/emails/form` shows the email as it would be sent, with the newest message or an example
  (`?text` for its text version). `html`, `rawHtml`, `defineEmails` and the `FormEmail` type are exported from
  `brimjs`.
- **`pauseOnHover` on a carousel**, on by default: off, autoplay keeps going under the pointer, for a backdrop.
- **In the editor a carousel holds still.** Autoplay waits outside the editor, so the slide the owner sees is the
  one they click and edit; `start` chooses which.
- **Images and import material stay out of git, and the guides for AI agents say so.** `brim-convert`,
  `brim-hosting`, the starter's `AGENTS.md` and the notes `brimjs init` writes: pictures that are content are uploads
  (`brim media add`, `brim_upload_image`), and what a site is filled from (product photos, catalogues, data for an
  import) goes in `import/`, which the starter's `.gitignore` now keeps out. The live site gets them with the
  content (`brimsites restore`), never with a deploy.
- **A host's own sign-in on the editor's sign-in form.** When the host sets `BRIM_HOST_SIGN_IN_URL` (and
  `BRIM_HOST_SIGN_IN_NAME`), the form offers "Continue with {name}" beside the password; the host checks who the
  person is and sends them back through a sign-in link (`/admin/api/session/link`). Brimsites uses it for
  "Continue with Brimsites". `/admin/api/info` lists it as `hostSignIn`.
- **`<Field>`: an item's picked values on its page.** A date, number, select, boolean, url or email field of an
  item can now be bound like text and images: `<Field nodeId="project-year" item={project} field="year" />`. The
  owner clicks it on the item's page and sets it in the side panel with the same widget as the item form; the value
  is saved into the item. By default a date and a number are written in the item's language, a set boolean as the
  field's label and a link or an email as a link; a function as children writes it its own way. In the template it
  is the item's content and stays locked. `PUT /nodes` and `brim_set_element` take kind `field` with
  `{ "value": … }` and `item`/`field`.
- **Bound elements say what they show, and stay in step with the page settings.** The toolbar of an element that
  shows an item's field has a chip naming it (`Project · Summary`). What is typed into it on the page shows in the
  field in Page Settings at each keystroke, and what is typed in Page Settings shows at once in every element of the
  page bound to that field.
- **Save, Discard, Undo and Redo in the editor.** What is changed in the editor no longer reaches visitors at once:
  it waits in a draft (`brim_drafts`, one for the whole site) that only the editor's preview shows, until someone
  presses Save (⌘S), which writes it to the site and to its history; Discard throws it away. Undo and Redo (⌘Z,
  ⇧⌘Z or Ctrl+Y, and the toolbar's arrows) step through the changes made in the window; while typing, ⌘Z undoes the
  typing first. Who can see a page or an item, and changes made in the content browser, still apply at once. The
  API takes `draft: true` on `PUT /nodes`, `DELETE /nodes`, `PUT /items` and `PUT /pages` (SEO only), and adds
  `GET`/`PUT`/`DELETE /admin/api/drafts`, `POST /admin/api/drafts/save` and `PUT /admin/api/items/visibility`;
  without `draft` (the MCP, scripts) changes are saved at once as before. In `astro dev` every page shows the draft.

- **A starting picture's own smaller copies**: `<Image src="/hero.webp" srcset="/hero-1024.webp 1024w, …" sizes="…" />`
  draws the code's `srcset` while that picture is shown, and leaves it out once the owner chose another (it would
  make browsers load the old picture). `sizes` is written once on the `<img>`; with an upload's `srcset` it was
  written twice.

- **Uploaded images carry their own width and height**: the media library reads an image's size from its file when
  it is uploaded (JPEG, PNG, GIF, WebP and AVIF, turned the way the browser turns a photo taken sideways) and keeps
  it with the file (migration 12). `imageSources`, a Gallery's or Carousel's `image.img`, `Image` and `Listing` cards
  give the `<img>` its `width` and `height`, so the browser keeps each picture's place before it arrives: a page no
  longer jumps as photos load, and a masonry gallery no longer reshuffles its columns with portrait photos. Images
  uploaded before are measured once by the server (a static build waits for it), read from the uploads folder or
  from `media.publicUrl`. A `srcset` stops at the image's own width, the image itself being the widest copy, instead
  of listing copies the CDN cannot make larger. Sites whose CSS sets an image's width (`width: 100%`) set
  `height: auto` with it, as Brim's own blocks do.
- **`brim check` warns about image sizes written as numbers** (`fixed-image-size`): an `<img>` that takes its
  address from `imageSources` or `image.img` and writes `width="1200" height="800"`, which gives every photo the same
  shape. And about **large images in public/** (`large-public-image`): over 500 KB, sent whole to every visitor.

- **Deploying with the Brimsites CLI**: `create-brim` prints the login / create / deploy steps, and the hosting guide
  says to install the CLI on the computer (`npm install -g @brimsites/brimsites`) and restore local content with
  `brimsites restore --content replace --yes`. 0.1.20 put the CLI in a new site's development dependencies, which
  stopped its deploy on Brimsites (the site's server cannot read the private package); 0.1.21 takes it out again.
- **Forms asked in steps**: an entry `{ type: "step", label, help }` among a form's fields starts a step. `Form` draws
  a tab per step, a progress bar and Back / Continue buttons (`backText`, `nextText`), checks each step before the
  next and keeps the consent and the send button for the last; the owner adds and moves steps among the fields in
  the editor. A field also takes `width: "half"` (two share a row where the form is wide enough) and `help`, a line
  under the question. `buttonClass` and `backClass` give the buttons the site's own classes, and a function child
  draws the fields in the site's markup with `Field`, the component of one question (`FormValue`).
- **`Search`**, a search of the whole site: the items of several content types, found by the words of their title,
  texts, rich text and blocks, whatever their case and accents, best first, each with the sentence the words are in.
  The words are in the address (`?q=`); a function child draws the results (`SearchState`). `searchItems` is the
  same search for a site's own code.
- **`brim check` warns about an order kept in a number field** (`order-field`): a field named `order`, `ordine`,
  `position`, `sort`, `rank`… of type number in a content type, where `ordered: true` lets the owner drag the items
  into order.

- **Items in the owner's order**: a content type declared `ordered: true` is put in order by dragging its items in
  the editor's Content (or with the arrow keys on a row's handle). `Listing`, `getItems`, the editor's lists and
  the seed follow that order unless the code sorts otherwise; `sort: "position"` names it. Behind it, a `position`
  on every item (a migration gives the items there the order they were added in), `PUT /admin/api/items/order`
  and the MCP's `brim_reorder_items`. A translation takes its original's place.
- **Menus built from content**: `from: "<content type>"` on a `Navbar` link makes its sub-links that type's items
  (title, page, first picture, for a megamenu), and on a `Footer` group its links. A category the owner adds is in
  the menu at once; in the editor's Navigation settings the owner switches a link between written sub-links and a
  type's items.
- **`brim check` warns about `<img src={mediaUrl(…)}>`** (`hand-drawn-image`): an image of the content drawn by
  hand has no `srcset`, so visitors download the full upload, and the owner cannot replace it from the page. The
  conversion skill and the starter's AGENTS.md now draw an item's picture with `<Image bare item={item} field="…" />`,
  which works in every card of a `Listing` too (each card saves into its own item).
- **`defineForm`**: a form declared once (`src/forms.ts`) and placed with `<Form form={contact} />` wherever the site
  needs it: one form in the site's shared content (`form-<key>`), edited once, its responses under one name.
  Mistakes in the declaration stop the site when it starts.
- **`brim check --content`**: reads the running site's content and warns about values left from testing (lorem
  ipsum, example.com, `.demo` addresses, `+40 000 000 000`, TODO), terms nothing uses, and dynamic routes no
  content type draws, which the sitemap cannot list. Behind it, `GET /admin/api/check/content` (owners).
- **`brim init` puts the project in git** (`git init`, nothing committed) unless it is in git already or
  `--no-git` is given.
- **The conversion skill says item lists are a `Listing`**, never `getItems(…).map(…)`: the owner adds items
  straight into the list (they start with its filter), and its facets, search and pages stay in the address.

- **`brim seed`**: the site's starting content kept in git as `seed/<type>.json` (pictures in `seed/images/`) and
  added to the running site. It only adds what the site does not have (same type, slug and language) and never
  changes or deletes anything; the whole seed is checked first, as the editor checks an item, and one mistake adds
  nothing. Terms go before what points at them, translations after their original, and only the pictures of what
  is added are uploaded, wherever the site keeps its media. `--dry-run` shows what it would add; `--export` writes
  the site's items and their pictures into `seed/`. It signs in to the local dev server by itself; another site
  needs `--url` and `--token`, a remote database `--remote`. Behind it, `GET` and `POST /admin/api/seed` (owners).

- **Pages for a vocabulary's terms, when you want them**, documented and wired into the editor: a vocabulary given
  `path` (`/produse/[slug]`) and `component` draws a page per term (the term comes as `item`), listed in the sitemap,
  with the term's fields beside it in the editor. In the site map the term's name opens its page and its chevron its
  items (Products → Ceramică → its products). A vocabulary without them stays a plain list.
- **`brim check` rule `vocabulary-page`**: warns about `src/pages/…/[category].astro` drawing a vocabulary's terms by
  hand, and refuses such a page left in place once the vocabulary has its own pages at that address.

- **The site map is one tree, by address.** A content type's items hang under the page their address starts with
  (`/produse/[category]/[slug]` under `/produse`), split by the field after it, so products sit under their
  category, every term of the vocabulary listed even before it has items. Clicking an item opens its page; each
  type and group has its own New (a new product in Ceramică starts in Ceramică), long lists show ten and then "Show
  all", and a search box finds pages and items alike. Types without pages and vocabularies are listed after the
  pages, under "Without a page".
- **Light or dark editor.** The ⋯ menu has Appearance: System, Light or Dark, remembered in the browser. Only the
  editor changes; the page being edited keeps the site's look.
- **A calendar for date fields** in the item form (and Site Settings), saving `YYYY-MM-DD` in local time; email
  fields are email inputs. The editor's outline of the hovered and selected element is drawn just outside it, so
  it never covers text or images at its edge, and the item form's text has full contrast in both themes.
- **Finding the editor.** Every page has a floating "Edit this page" button for whoever may edit: everyone on the
  dev server, signed-in users on the live site (never for visitors, never inside the editor). `?edit` after any address opens that page in the editor; `/admin` and `/edit` open
  it too. `brim open [email] [--page] [--url]` opens it in the browser already signed in (a one-time link, which now
  takes `to`); the dev server and `brim start` print its address; agents are told to open it for the person.
- **Typed items.** `defineContentType`, `defineVocabulary` and `defineSiteSettings` keep their fields' types:
  `ItemOf<typeof product>`, `ItemPageProps<typeof product>`, `getItems(product)`, `getItem(product, slug)` and
  `getSiteSettings(siteSettings)` give `data` its real types (a required number is a `number`, a select the union of
  its values, a gallery a list of `{ src, alt }`…). `BrowseState`, `Facet` and `FacetOption` are exported for
  `Listing` controls. Passing a key (`getItems("product")`) still works, untyped.
- **`<Shared>`.** Everything inside it is saved once for the whole site (as if each element said `scope="site"`),
  for sections repeated with the same content on several pages: the owner edits a FAQ or the quote form once.
- **Safer projects.** `brim check` reports a password written in a file of the project (a login note, a README) as
  an error, and warns when the site is not in git. `create-brim` makes the new site a git repository with a first
  commit (`--no-git` to skip), and `brim user add` points to `brim user link` for signing someone in without passing
  a password around; the agent guides say never to write passwords or tokens into files.
- **Site settings.** A site declares its own settings in `src/site-settings.ts` (`defineSiteSettings`, with the
  fields of a content type plus `group` and `default`): phone, email, WhatsApp, social profiles, address, opening
  hours, legal links. The owner edits them in Site Settings (now open to everyone who changes content), per language;
  pages read them with `getSiteSettings()` and show them with `<Setting name="…" />`, which opens Site Settings at
  that field when clicked in the editor. MCP: `brim_site_settings`, `brim_set_site_settings`. `brim check` warns
  about contact details written in the code; the starter declares email, phone and address and shows them in its
  footer.
- **Vocabularies and references.** `defineVocabulary` declares a list the owner keeps (categories, brands…) as a
  content type whose items are its terms; a field naming it (`vocabulary: "category"`, or `type: "reference"` with
  `to`, and `multiple`) points other items at them by slug. Wherever item fields are edited, one reference widget
  offers the terms as you type and adds a missing one to the vocabulary ("Add … to Categories"); the server refuses terms that do not exist, carries references along when
  a term changes its address, and keeps a term in use from being deleted. References can be part of a `path`, a
  `Listing` facet (with the terms' titles) and searched; `getReferences()` reads them on a page. The editor's
  Content lists vocabularies after the other types.
- **`brim check` warns about `/uploads/…` addresses in the code** (pages, components, data modules, JSON): uploads
  are not in git, so such code breaks on a fresh clone or a deploy without the content. The conversion skill, the
  starter's `AGENTS.md`, `brim init` and the MCP's instructions tell agents to keep upload addresses in items' fields
  and elements' saved values, with a starting picture of the code's own.
- **The `media` option: where images are kept and how they reach visitors.** `storage` sends uploads to any storage
  that takes `PUT` (with the site's headers) instead of the server's disk, `publicUrl` serves them from a CDN,
  `resize` (an address with `{url}` and `{width}`) gives Brim's images a `srcset` of smaller copies. Content keeps its
  `/uploads/…` addresses; the server leads other requests for them to the public address. `mediaUrl()` and
  `imageSources()` from `brimjs/content` do the same in a site's own markup. `BRIM_MEDIA_STORAGE_URL`, `_TOKEN`,
  `BRIM_MEDIA_PUBLIC_URL` and `BRIM_MEDIA_RESIZE` override the config, for hosts.
- **Images into the media library, for AI agents and scripts.** The MCP's `brim_upload_image` takes a public web
  address (fetched by the server, which refuses its own network) or base64, and `brim media add <files…> [--item
  <type>/<id>]` uploads from the computer; both answer the `/uploads/…` address. The conversion skill, the starter's
  `AGENTS.md` and `brim init` tell agents to put pictures that are content there, not in `public/`.
- **`Image bare`** draws only the `<img>`, with the attributes the code gives it, for a site whose CSS styles the
  image itself; the owner still replaces the picture and its description.
- **`brim check`** reads a site's source and reports duplicate nodeIds (per page, following local components, and
  site-wide for `scope="site"`), positional ids such as `text-3`, and files left unchanged from the `create-brim`
  starter; exits with 1 on errors, `--json` for machines.
- **Listing facets, search and pages.** `facets`, `search` and `pageSize` on `Listing` let visitors narrow a
  catalog themselves through the page's address, drawn on the server with no script: checkboxes with counts for the
  values of chosen fields, a search that ignores case and accents, and page links. A `controls` function gets
  the whole state to draw them in the site's own markup; `labels` translates Brim's words.
- **More field types.** A `keyvalue` field holds rows of `{ label, value }` (technical details, a spec sheet),
  edited as a list in the item form. A `select` field takes choices as `{ value, label }` besides plain strings: the
  value is saved (fit for an address or a filter), the label is shown; `choiceLabel()` (from `brimjs/content`) and
  `optionLabel()` (from `brimjs`) give a page the label.
- **Navbar groups.** Navbar items can have `children` (sub-links, two levels deep) and an optional `image`, for
  dropdowns and megamenus. The owner edits them in the navbar's panel with the usual link and image widgets, and the
  MCP accepts them in `brim_set_element`. Saved navbars without children keep working; footer links stay plain. New
  exported type `NavLink`.
- **A content type's `path`.** `path: "/shop/[category]/[slug]"` puts an item's page under the value of one of its
  fields instead of at `/<slug>/<address>`: the template draws it there, with what the owner changed on the template,
  and `item.url`, the sitemap, feeds, the editor's links and the editor follow it. A former address of the item (its
  category changed) redirects to the current one with a 301. Only required `select` and `text` fields can be part of
  it; a value with no letters or digits is refused when the item is saved.
- **Roles are checked.** A third role, `writer`, joins `owner` and `editor`, and the editor's API (and the site MCP,
  which goes through it) refuses what a role does not allow: a writer changes words, pictures and item fields and
  adds private items; an editor also publishes, deletes items, adds, moves and deletes pages and reads form
  responses; an owner also changes content type templates, Site Settings, redirects and page passwords. The rule
  is `ROLE_PERMISSIONS`, exported from `brimjs`; `GET /admin/api/session` answers the user's permissions and the
  editor hides what will not work.
- **History.** Changes of content are kept for 90 days and can be taken back from the editor (account menu →
  History), the API (`GET /admin/api/history`, `POST /admin/api/history/restore`) and the site MCP
  (`brim_list_history`, `brim_restore_history`): elements changed or reset, items changed or deleted, deleted pages.
- **Items have an author.** Every content type gets a text field `author` after its declared fields, unless it
  says `author: false` or declares a field named `author` of its own. An item's page gives it to search engines as
  `<meta name="author">`; `<Seo>` takes an `author` prop for other pages. The starter's article page shows it next
  to the date.
- **Tags.** A field type `tags` (a list of short words, edited as chips), and every content type gets a `tags`
  field after the author, unless it says `tags: false` or declares a field named `tags` of its own (with `options`,
  it takes only those, as it spells them). A tag is the same whatever its case. The editor's Content lists only the
  items that have a tag when its chip is clicked and finds items by tag; `Listing` filters on them already (`filter={{ tags: "garden" }}`), its plain card shows them as
  labels (`tags={false}` hides them), and `brim_list_items` takes a `tag`.
- **`brim init`** (`npx brimjs init`): sets up Brim.js in an Astro project that already exists and writes a
  conversion guide for AI coding agents (`.claude/skills/brim-convert/SKILL.md`).

### Changed

- `Listing`'s `search: true` also finds the words of rich text and blocks fields, read as text without their tags
  and settings.
- `Form` puts its fields in a `.brim-form__fields` grid; each field has `data-width` and `data-name`, and the send
  button `.brim-form__submit`.

- **A block of a `blocks` field has a layout**: how wide it is (`narrow`, `content`, `wide`, `full`), to which
  side, and the space above it (`none`, `small`, `normal`, `large`: steps of the site's `--brim-block-gap`, the one
  space between blocks), chosen in its side panel, the same for every kind of block. Blocks are drawn in `.brim-block` with
  `data-width` and `data-align`; the site sets the widths with `--brim-block-narrow`, `--brim-block-content` and
  `--brim-block-wide`, and a block's pictures are downloaded at its width. Blocks saved before keep their size and
  alignment as their layout.
- **`Image`, `Button`, `Map`, `Divider` and `Icon` keep their content, not their look.** `Image` is its picture,
  description, caption, link and focal point: its `size`, `customWidth`, shapes, rotation, opacity, overlay and fill
  are the site's CSS (`bare` draws only the `<img>`, as before). `Button` is its words, link, `variant`, `size` and
  icon: `inlineAlignment`, `iconPosition`, `iconLayout` and `customClassName` are gone, it no longer sits in a
  `.brim-btn-row`, and `class` goes on the button. `Map` lost `size`, `Divider` everything but its orientation (its
  line is CSS on `.brim-divider`), `Icon` its `iconStyle` and `bgShape`; each takes a `class`. In a `blocks` field,
  the block's layout gives them their width and side.
- **`SocialMedia`, `Form` and `Video` are their content, not a look.** `SocialMedia` lost its icon colour,
  background and shape: Brim draws plain icons in the text's colour, and a function child draws anything else
  (`{({ links }) => …}`, each link with its `network`, `label`, `href`, `icon` and `newTab`); `profiles={{ instagram:
  "…" }}` starts the profile links. `Form` lost `buttonAlign`, `buttonFullWidth` and the unused BrimCMS settings
  (steps, appointments, colours, input and typography styles, confirmation e-mails): its look is CSS on its classes.
  `Video` lost `size`, `customWidth`, `objectFit`, the overlay and the scroll, speed and fade settings: Brim frames
  it 16:9 at the width it is given, and `bare` draws only the player for the site to style. Saved values that have
  the old settings are read without them.
- **`Gallery` and `Carousel` are their images, not a look**: the owner adds, orders and describes the images in
  the side panel, and the components give each one its `<img>` attributes with a `srcset`. A function child draws
  them in any shape (`{({ images }) => …}`, `{({ slides }) => …}`); the carousel's script moves whatever the markup
  marks (`data-track`, `data-previous`, `data-next`, `data-go`), opens on `start`, and rolls a `continuous` strip
  of logos at their own widths. `item` and `field` show an item's `gallery` field and save into it. The BrimCMS
  look settings are gone: a gallery's `variation` (masonry), `tabletColumns`, `mobileColumns` and
  `imageAspectRatio`, a carousel's `tabletSlidesPerView`, `mobileSlidesPerView`, `captionStyle`, `portraitFormat`,
  `pauseOnHover` and the arrow and transition styles; draw them in the site instead. A gallery image's `title` is
  read as its caption. `Gallery` is the new name of `ImageGallery`, which stays.
- **`Accordion` is only its questions**: no heading and no intro any more, which every accordion drew by default
  ("Frequently Asked Questions", "Everything you need to know…") unless the site turned them off. Write the
  heading above it as a `Text`; `heading`, `showHeading`, `intro` and `showIntro` are gone, and saved values that
  have them are read without them.
- **`Text` checks its starting content while editing.** Markup the owner's first edit would silently lose (a Brim
  element nested in a Text, paragraphs, lists and other block elements, pictures, a class or other attribute on an
  inline element) now stops the page in `astro dev` with an error naming the `nodeId` and the fix (use `RichText`,
  move the element out, or split the Text). On the live server a signed-in owner sees the page as before and the
  editor locks that element; the public site never runs the check. Line breaks, bold, italic, underline,
  strikethrough, sub- and superscript, colors and links keep working and are drawn the same after an edit.
- **The dev server draws pages on request** (Astro's `output: "server"` while `astro dev` runs), like the Node server
  a build makes, so a page reads its address's query there too.
- **New sites depend on the private package.** `create-brim` writes `"brimjs": "npm:@brimsites/brimjs@^<version>"`
  (a version given with `--brim` too), and `brim init` adds the same, instead of a public `brimjs` that is not
  published. The README says how to reach GitHub Packages, and how starting content gets into a new site.
- **`Listing`'s `filter` matches text whatever its case**: `{ section: "guides" }` lists the items of "Guides", and
  `{ tags: "garden" }` those tagged "Garden".
- **An `editor` can no longer change a content type's template** (elements saved with scope `template`): that is an
  owner's. Give the role `owner` to whoever needs it: `brim user role <email> owner`.
- Database schema version 11: `brim_users` accepts the role `writer`; new table `brim_history`. A host that keeps
  its own copy of the schema must add both.

### Fixed

- **The MCP keeps line breaks and formatting in texts.** `brim_read_page` gives a text's formatting as `rich`, and
  `brim_set_text` saves a `\n` as a line break and accepts `rich`, instead of flattening everything into one line.
- **The editor no longer stutters near the bottom edge of a selected block.** The + and the element toolbar stay
  inside the page's frame: drawn past it, they made the canvas scroll, and its scrollbar narrowed the page, which
  moved them back inside, on every frame. Low on the page, the + opens its list upwards.
