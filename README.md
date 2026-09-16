# Filfil public site mirror

This repository can capture the public pages and same-host assets of `https://filfilworld.com/` and serve the result from Nginx. A mirror is a snapshot. It cannot recover a CMS database, source code, private pages, form processing, search indexes, or logins.

## Capture

Use a machine that can open the site in Chrome. This workspace currently gets a TLS timeout from the site, so its first attempted capture produced **zero pages**. Do not deploy until `filfil-site/index.html` exists and `mirror-report.json` shows the expected pages and no significant failures.

```sh
pnpm install
pnpm mirror
pnpm mirror:lists
pnpm mirror
```

The crawler follows same-host links, reads available XML sitemaps, renders pages in Chrome, saves observed same-host assets, and rewrites local page, image, CSS, and script URLs. It keeps existing files if a later run fails. Check `filfil-site/mirror-report.json` for each saved URL and failure. A nonzero exit status means the capture is incomplete.

Rerunning `pnpm mirror` resumes from the report and skips saved pages and assets. It retries failed items and refreshes CSS to pick up referenced assets. To crawl every page again after the live site changes, run `FILFIL_REFRESH=1 pnpm mirror`.

`pnpm mirror:lists` captures the remaining recipe, magazine, and product cards from the site's public pagination endpoints and makes their “more” buttons work without a server. The following `pnpm mirror` captures detail pages that those cards reveal. It may still exit with status 1 for unrelated URLs that already return 404 or 500 on the live site.

Useful controls:

```sh
FILFIL_URL=https://filfilworld.com/ FILFIL_OUTPUT=filfil-site FILFIL_MAX_PAGES=10000 FILFIL_TIMEOUT_MS=20000 pnpm mirror
```

The language links point to `en.filfilworld.com`, `ar.filfilworld.com`, and `de.filfilworld.com`; these are separate hosts. Capture each with its own `FILFIL_URL` and `FILFIL_OUTPUT` if you also control those sites. The default run captures only `filfilworld.com`.

## Preview and container

After a successful capture:

```sh
python3 -m http.server 8080 --directory filfil-site
# or
docker build -t filfil-static .
docker run --rm -p 8080:80 filfil-static
```

Open `http://localhost:8080/`. The Docker build intentionally fails if there is no captured home page. To publish later, point the domain's DNS to your container host and put HTTPS termination in front of port 80. DNS and publishing are separate steps; this repository does not change either.

## Replacement work before publishing

- Click through every product, recipe, article, menu, image, and language link in the preview. Compare with the live site. Pages loaded only after a button click or API call may need manual additions to the crawler.
- If publishing the static Nginx container, disable or replace the contact, collaboration, career, product comment, rating, and search forms. Static HTML alone cannot process them. The optional Node backend below handles fresh submissions, ratings, and search.
- Inspect `mirror-report.json` for failed URLs. External assets and third-party services are outside the same-host capture.
- Create an editing workflow. For occasional changes, edit HTML/CSS/assets directly. For ongoing product and article updates, move the content into a static site generator or another CMS you control.

The public HTTP endpoint currently reports `X-Powered-By: ASP.NET` behind ArvanCloud. The site may therefore not be served by WordPress at all. Only someone with hosting or origin access can confirm its backend. Ownership of the domain alone is enough to redirect traffic, but it does not grant access to the current server's source or database.

## Fresh backend (optional)

The static site needs no database for browsing. To accept **new** contact messages, product comments, career applications, partner applications, ratings, and local search, run the Node server with SQLite:

```sh
FILFIL_ADMIN_TOKEN='choose-a-long-random-secret' pnpm start
```

Open `http://localhost:8080/`. Submissions are stored in `data/filfil.sqlite`; no old database is imported. Keep `data/` outside source control and back it up. Read recent submissions with `curl -H "Authorization: Bearer YOUR_SECRET" http://localhost:8080/api/submissions`. Retrieve a submission's private attachment at `/api/submissions/ID/attachment` with the same token. Search is generated from the saved HTML and does not need database records.

To run the backend in a container:

```sh
docker build -f Dockerfile.app -t filfil-app .
docker run --rm -p 8080:8080 -v filfil-data:/app/data -e FILFIL_ADMIN_TOKEN='choose-a-long-random-secret' filfil-app
```

The server injects `server-client.js` into captured pages at response time; the archived HTML is unchanged. It removes the obsolete CAPTCHA and old anti-forgery token from submissions, then saves fresh entries. New product comments are private submissions for review; the old public comment area is a snapshot. Career and partner forms keep their existing fields, with a text city field replacing the obsolete dependent city dropdown. The old career dynamic-field endpoint returns an empty response. Configure your own email notifications, moderation view, and spam controls before inviting public submissions; the built-in rate limit is basic. Set up HTTPS at the public reverse proxy and retain the SQLite volume across container updates.
