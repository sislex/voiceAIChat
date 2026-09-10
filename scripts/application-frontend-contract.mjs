// Контракт исполняет IIFE кандидата через собранный host именно baseline-образа.
// Текущий исходник загрузчика не может доказать совместимость со старой оболочкой.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { APPLICATION_CATALOG } from "../packages/shared/src/applicationCatalog.ts";
import { parseApplicationFrontendManifest } from "../packages/shared/src/applicationFrontend.ts";
import { applicationRuntimeMatches } from "../packages/shared/src/applicationRelease.ts";
import { contractHttp } from "./application-contract-http.mjs";
const definitions = {
  "make-ui": {
    kind: "make",
    route: "make",
    selector: '[data-testid="make-pane"]',
  },
  "image-studio-ui": {
    kind: "images",
    route: "images",
    selector: ".image-studio",
  },
  "playwright-reader-ui": {
    kind: "playwright-reader",
    route: "playwright-reader",
    selector: ".playwright-browser-pane",
  },
  "web-reader-ui": {
    kind: "web-recorder",
    route: "web-reader",
    selector: ".webpreview",
  },
};
export async function verifyFrontendCompatibility({
  candidate,
  baselines,
  urls,
  token,
}) {
  const app = definitions[candidate.applicationId],
    base = urls[candidate.artifacts[0].service];
  assert.ok(app && base);
  const request = async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200);
    return response;
  };
  const manifest = parseApplicationFrontendManifest(
    await (await request(base + "/manifest.json")).json(),
    candidate.applicationId,
  );
  assert.equal(manifest.version, candidate.version);
  assert.equal(manifest.commit, candidate.commit);
  assert.equal(manifest.apiVersion, candidate.apiVersion);
  for (const asset of [manifest.entry, ...manifest.styles])
    assert.equal(
      "sha384-" +
        createHash("sha384")
          .update(
            Buffer.from(
              await (await request(base + "/" + asset.path)).arrayBuffer(),
            ),
          )
          .digest("base64"),
      asset.integrity,
    );
  // Матрица проверяет заявленные реальные baseline, включая их API/version.
  for (const release of baselines) {
    const definition = APPLICATION_CATALOG.find(
      (app) => app.id === release.applicationId,
    );
    for (const artifact of release.artifacts) {
      const response = await fetch(
        urls[artifact.service] + definition.healthPath,
        {
          headers: { authorization: "Bearer " + token },
          signal: AbortSignal.timeout(10000),
        },
      );
      assert.equal(response.status, 200);
      assert.ok(
        applicationRuntimeMatches(release, (await response.json()).application),
      );
    }
  }
  const core = urls.voicechat;
  assert.ok(
    core,
    "UI-матрице нужен полный baseline ядра с собранной оболочкой",
  );
  const http = contractHttp(token);
  const gatewayManifest = parseApplicationFrontendManifest(
    await http(
      core,
      "/applications/" + candidate.applicationId + "/manifest.json",
    ),
    candidate.applicationId,
  );
  assert.deepEqual(
    gatewayManifest,
    manifest,
    "Baseline host должен отдавать manifest именно кандидата",
  );
  const { token: auth } = await http(core, "/api/session/login", {
    method: "POST",
    body: { name: "admin", password: token },
  });
  await http(core, "/api/settings", {
    method: "PUT",
    auth,
    body: { onboarded: true },
  });
  const conversation = await http(core, "/api/conversations", {
    method: "POST",
    auth,
    body: { title: "Frontend compatibility", assistantKind: app.kind },
  });
  const conversationId = conversation.id ?? conversation.conversation?.id;
  assert.equal(typeof conversationId, "string");
  if (candidate.applicationId === "make-ui") {
    await http(core, `/api/make/${conversationId}/file`, {
      method: "PUT",
      auth,
      body: {
        path: "index.html",
        content: "<!doctype html><h1>Frontend compatibility</h1>",
      },
    });
  }
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
      }),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(core);
    await page.evaluate(
      (auth) => localStorage.setItem("vc.session.token", auth),
      auth,
    );
    await page.goto(core + "/#/" + app.route + "/" + conversationId);
    await page.reload();
    await page.locator(app.selector).waitFor({ timeout: 30000 });
    assert.equal(
      await page.locator('script[src$="' + manifest.entry.path + '"]').count(),
      1,
      "Панель должна прийти из кандидата, а не из embedded bundle baseline",
    );
    if (candidate.applicationId === "make-ui") {
      await page.getByRole("tab", { name: "Код", exact: true }).click();
      await page.getByRole("button", { name: /^index\.html/ }).click();
      await page.locator(".monaco-editor").first().waitFor({ timeout: 30000 });
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
  }
}
