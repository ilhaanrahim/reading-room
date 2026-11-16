# The Reading Room

A personal reading tracker that runs entirely in the browser. It does not need a server, database account, build step, or API key.

## Use it

- Select **Add a book** and search Open Library by title, author, or ISBN. Choose a result, check the suggested category and tags, and save it. You can also add a book manually.
- Categories are bookshelves; tags can describe subjects inside them. Edit a book to change its shelf, title, author, tags, cover, or 1–10 rating. The library sorts shelves and their books alphabetically.
- Upload a cover to keep a compressed copy on this device, or enter an HTTPS image URL. Open Library covers use online URLs and might not show when offline.
- Use **Export backup** to save a JSON file that includes books, ratings, tags and uploaded covers. Keep the backup somewhere safe. **Import backup** adds new records and updates matching records; unrelated books stay in place.
- After the app has been opened online at least once, the app and its locally saved data can be used offline in a browser that supports service workers. Search and remote covers require the internet.

## Where data lives

Books and uploaded covers are stored locally by the browser in IndexedDB, not in your GitHub repository or on a server. Data does not sync between devices or browser profiles. Clearing site data, using a temporary/private session, or losing the device may delete it. Export backups regularly.

Every website address has separate browser storage: if you move from a preview URL to GitHub Pages or a different browser, export on the old address and import on the new one.

## Host on GitHub Pages

1. Create a new public repository on GitHub, for example `reading-room`.
2. Upload the files from the `dist` folder to the **root** of the repository. If you downloaded the ready-to-upload ZIP, extract it first and upload the extracted files so `index.html` is at the root. Do not upload the parent folder itself.
3. In the repository, open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then choose `main` and `/(root)` and save.
4. Wait for GitHub Pages to publish and open the site URL shown in the Pages settings. Open it once while online to make its app files available offline.

GitHub Pages is public by default. This publishes the application files only; book entries remain in each visitor's browser, unless you separately publish or share a backup.

## Local development

Serve `dist` with any static HTTP server (for example, run `python3 -m http.server` inside `dist`) and open the local address. Use HTTPS for deployed sites. Opening the HTML directly as a `file://` URL is not recommended because browser storage and offline behavior differ.

## Credits

Book discovery and remote covers use [Open Library](https://openlibrary.org/). Catalog categories and tags are simple suggestions, not guaranteed classifications.
