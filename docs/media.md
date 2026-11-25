---
title: Media
section: Build
order: 6
lead: Pictures of the design live in public/, pictures of the content are uploads in the media library, and videos go through a video host.
---

## Pictures of the design, pictures of the content

The pictures the design starts with (a hero, the pictures of sections, a gallery the site ships with, the logo) are files of the code in `public/`, at most 2560 px wide. On a server, every page gets smaller WebP copies of them from Astro's image endpoint, and the owner can replace any of them in the editor.

Pictures of items (products, projects, articles, people) and pictures the owner adds are uploads. They live in the media library, in `public/uploads` and the database, and travel with the content, not with git.

Upload addresses belong in the content, never in the code. A page that names `/uploads/…` shows broken pictures on a fresh clone and on a deploy that has not brought the content along. A picture of an item goes in the item's image field; a picture of a fixed section is the element's saved value over a starting picture in `public/`. `brim check` warns about every `/uploads/…` address in `src/`, and about a picture in `public/` larger than 500 KB or wider than 2560 px.

## Uploading

Click an image on the page and replace it in the side panel, or drop a file on it. Choose from site searches the whole library and loads as it scrolls.

| Uploaded from | Goes to |
| --- | --- |
| A block on a page | The gallery |
| An item's form, or an element bound to an item | The gallery or the item's own folder; the owner chooses |

From the command line or an agent:

```bash
npx brim media add photos/*.jpg                                # into the gallery
npx brim media add lamp-1.jpg lamp-2.jpg --item product/<id>   # into one item's folder
```

Each prints the `/uploads/…` address to use in an item's image field. JPEG, PNG, GIF, WebP and AVIF of up to 10 MB are taken. Over MCP, `brim_upload_image` adds one from a public web address or base64, and `brim_list_media` lists the library.

## Sizes and srcset

Brim measures every upload, so its images carry `width` and `height` and pages do not jump while photos load. Leave `width` and `height` out of your markup and give the image `height: auto` where the CSS sets its width.

For an item's picture, `<Image bare>` draws only the `<img>` with its `srcset`, and the owner can still replace the picture from the page, in a template as in every card of a `Listing`:

```astro
<Image bare nodeId="product-card-image" item={item} field="image" src="" alt="" class="card__image"
  loading="lazy" sizes="(max-width: 768px) 100vw, 33vw" />
```

In your own markup, `mediaUrl(src)` and `imageSources(src, sizes)` from `brimjs/content` give the public address and the `srcset`:

```astro
<img {...imageSources(item.data.image.src, "(max-width: 768px) 100vw, 33vw")} alt={item.data.image.alt} />
```

`brim check` warns about `<img src={mediaUrl(…)}>`, which sends every visitor the full upload.

## Storage and CDN

By default uploads are in `public/uploads` and the site's own server sends them at full size. For a busy site, put them in a storage and serve them from a CDN that makes smaller copies:

```js
// astro.config.mjs
brim({
  media: {
    // Each upload is sent with PUT <url>/uploads/<file>, with these headers.
    storage: { url: "https://storage.example.com/my-site", headers: { Authorization: `Bearer ${process.env.STORAGE_TOKEN}` } },
    // Visitors get <publicUrl>/uploads/<file>: the CDN in front of the storage.
    publicUrl: "https://cdn.example.com/my-site",
    // How the CDN makes a smaller copy; Brim's images then carry a srcset of these widths.
    resize: "{url}?width={width}",
    widths: [320, 640, 960, 1280, 1920, 2560],
  },
});
```

Every part is optional and works alone. Content keeps its `/uploads/…` addresses whatever is set, so the same database works locally, on your server and on a host. A host can set it without touching the code: `BRIM_MEDIA_STORAGE_URL`, `BRIM_MEDIA_STORAGE_TOKEN`, `BRIM_MEDIA_PUBLIC_URL` and `BRIM_MEDIA_RESIZE` win over the config.

## Video uploads

The `Video` block plays a YouTube or Vimeo link, a video file or an HLS stream (`.m3u8`; `hls.js` loads only on pages that need it).

Brim does not store or convert videos. To let owners upload one from the editor, give the site a video host: any service that answers a few calls. Brim only keeps its address and token, and the browser sends the file straight to the host with the tus protocol.

```js
// astro.config.mjs
brim({ videoUploads: { url: "https://videos.example.com/sites/my-site/videos", token: process.env.VIDEO_TOKEN } });
```

`BRIM_VIDEO_UPLOADS_URL` and `BRIM_VIDEO_UPLOADS_TOKEN` do the same from the environment. The address must be HTTPS (plain HTTP only on `localhost`). Without one, the editor shows only the field for a pasted link.

The site's server calls the host with `Authorization: Bearer <token>`:

- `POST {url}` with `{ "name", "size", "type" }` answers `201` with `{ "id", "upload": { "protocol": "tus", "endpoint", "headers", "metadata" }, "url", "posterUrl" }`.
- `GET {url}/{id}` answers `{ "id", "status": "processing" | "ready" | "failed", "progress", "url", "posterUrl" }`.
- A refusal is `{ "error": "a message for the person" }` with a 4xx or 5xx status.

Two more calls are optional. With them the video block's settings list the uploaded videos, to use one again or delete it, so a video nobody shows no longer takes up space on the host:

- `GET {url}` answers `{ "videos": [ { "id", "name", "size", "status", "url", "posterUrl", "createdAt" } ] }`, newest first (`size` in bytes, `createdAt` an ISO date).
- `DELETE {url}/{id}` removes the video for good and answers any 2xx, with `{ "deleted": true }` or nothing; `404` when the video is not this site's.

A host that does not list videos answers `GET {url}` with `404`, `405` or `501`, and the editor shows no list.

The tus endpoint must allow cross-origin requests and expose `Location` and `Upload-Offset`. When the upload is done the editor waits until the video is `ready`, then writes its `url` (and poster) into the block.
