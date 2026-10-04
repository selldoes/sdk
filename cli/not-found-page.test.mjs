import assert from "node:assert/strict"
import test from "node:test"
import { notFoundHtml, sendNotFound, wantsHtmlPage } from "./not-found-page.mjs"

function fakeReq({ method = "GET", accept = "text/html", headers = {} } = {}) {
  return { method, url: "/some/page", headers: { accept, ...headers } }
}

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: undefined }
  res.writeHead = (status, headers) => {
    res.statusCode = status
    res.headers = headers ?? {}
  }
  res.end = (body) => {
    res.body = body
  }
  return res
}

test("wantsHtmlPage: browser navigations want HTML, API clients want JSON", () => {
  assert.equal(wantsHtmlPage(fakeReq({ accept: "text/html,application/xhtml+xml" })), true)
  assert.equal(wantsHtmlPage(fakeReq({ accept: "*/*", headers: { "sec-fetch-mode": "navigate" } })), true)
  assert.equal(wantsHtmlPage(fakeReq({ accept: "application/json" })), false)
  assert.equal(wantsHtmlPage(fakeReq({ method: "POST", accept: "text/html" })), false)
  assert.equal(wantsHtmlPage(fakeReq({ method: "HEAD", accept: "text/html" })), true)
})

test("notFoundHtml: styled page with the path, home action and quick links", () => {
  const html = notFoundHtml({
    pathname: "/eadce106290a/settings",
    homeUrl: "/eadce106290a",
    homeLabel: "Back to Demo Plugin",
    links: [
      { to: "/eadce106290a", label: "Overview" },
      { to: "/eadce106290a/settings", label: "Settings" },
    ],
    hint: "Pick a page from the sidebar.",
  })
  assert.match(html, /404/)
  assert.match(html, /Page not found/)
  assert.match(html, /\/eadce106290a\/settings/)
  assert.match(html, /Back to Demo Plugin/)
  assert.match(html, /Pick a page from the sidebar\./)
  assert.match(html, /href="\/eadce106290a"/)
  assert.doesNotMatch(html, /\{"error"/)
})

test("notFoundHtml: escapes user-controlled values", () => {
  const html = notFoundHtml({ pathname: '/<script>alert("x")</script>', homeUrl: '/"><img src=x>' })
  assert.doesNotMatch(html, /<script>alert/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&quot;/)
})

test("sendNotFound: browsers get the HTML page, API clients keep the JSON body", () => {
  const browser = fakeRes()
  sendNotFound(fakeReq(), browser, { pathname: "/eadce106290a/settings" })
  assert.equal(browser.statusCode, 404)
  assert.match(browser.headers["Content-Type"], /text\/html/)
  assert.match(browser.body, /Page not found/)

  const api = fakeRes()
  sendNotFound(fakeReq({ accept: "application/json" }), api, { pathname: "/eadce106290a/settings" })
  assert.equal(api.statusCode, 404)
  assert.match(api.headers["Content-Type"], /application\/json/)
  assert.deepEqual(JSON.parse(api.body), { error: "Not found: /eadce106290a/settings" })
})

test("sendNotFound: HEAD navigations get headers without a body", () => {
  const res = fakeRes()
  sendNotFound(fakeReq({ method: "HEAD" }), res, { pathname: "/gone" })
  assert.equal(res.statusCode, 404)
  assert.match(res.headers["Content-Type"], /text\/html/)
  assert.equal(res.body, undefined)
})
