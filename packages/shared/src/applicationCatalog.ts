// Один каталог связывает владельцев кода, гейты и артефакты. Runtime-зависимости
// версионируются внутри выпуска, а не выводятся из npm-зависимостей исходников.
import {
  APPLICATION_ID_RE,
  type ApplicationReleaseManifest,
} from "./applicationRelease";
export interface ApplicationDefinition {
  id: string;
  name: string;
  paths: string[];
  workspaces: string[];
  buildDependencies: string[];
  runtimeDependencies: string[];
  optionalRuntimeDependencies?: string[];
  browserPaths: string[];
  e2eFiles: string[];
  contractPaths: string[];
  contractChecks: { workspace: string; files: string[] }[];
  services: string[];
  entrypoint?: string;
  frontend?: { entry: string };
  healthPath?: string;
  dataPaths: string[];
  configuration: string[];
  isolation: { tests: boolean; build: boolean; deploy: boolean };
  kind: "service" | "frontend" | "client" | "library";
}
const definition = (
  id: string,
  name: string,
  path: string,
  options: Partial<Omit<ApplicationDefinition, "id" | "name" | "paths">> & {
    paths?: string[];
  } = {},
): ApplicationDefinition => ({
  id,
  name,
  paths: [path],
  workspaces: [`@voicechat/${id}`],
  buildDependencies: ["shared"],
  runtimeDependencies: [],
  browserPaths: [],
  e2eFiles: [],
  contractPaths: [],
  contractChecks: [],
  services: [],
  dataPaths: [],
  configuration: [],
  isolation: { tests: false, build: false, deploy: false },
  kind: "service",
  ...options,
});
export const APPLICATION_CATALOG: readonly ApplicationDefinition[] = [
  definition("core", "Ядро", "apps/server", {
    optionalRuntimeDependencies: [
      "make",
      "image-studio",
      "playwright-reader",
      "browser-runner",
      "llm-runner",
      "stt-runner",
      "tts-runner",
      "make-ui",
      "image-studio-ui",
      "playwright-reader-ui",
      "web-reader-ui",
    ],
    isolation: { tests: false, build: true, deploy: false },
    workspaces: ["@voicechat/server"],
    services: ["voicechat"],
    entrypoint: "apps/server/src/index.ts",
    healthPath: "/api/health",
    dataPaths: ["database", "users", "conversations"],
    buildDependencies: [
      "shared",
      "sessions-core",
      "make-contracts",
      "make",
      "image-studio",
      "playwright-reader",
      "browser-runner",
      "llm-runner",
    ],
  }),
  definition("make", "Make", "apps/make", {
    browserPaths: ["apps/make/src/routes.ts", "apps/make/src/transpile.ts"],
    e2eFiles: ["e2e/make.e2e.test.ts"],
    runtimeDependencies: ["core"],
    services: ["make"],
    entrypoint: "apps/make/src/standalone/index.ts",
    healthPath: "/v1/health",
    dataPaths: ["make"],
    configuration: [
      "VC_CORE_URL",
      "VC_INTERNAL_TOKEN",
      "VC_MCP_SECRET",
      "VC_DATA_DIR",
    ],
    buildDependencies: ["shared", "make-contracts"],
    contractPaths: [
      "apps/make/src/core.ts",
      "apps/make/src/service.ts",
      "apps/make/src/internal.ts",
      "apps/make/src/taskScope.ts",
      "apps/make/src/hub.ts",
      "apps/make/src/index.ts",
      "apps/make/src/routes.ts",
      "apps/make/src/mcp.ts",
    ],
    contractChecks: [
      { workspace: "@voicechat/server", files: ["src/makeBridge"] },
    ],
    isolation: { tests: true, build: true, deploy: true },
  }),
  definition("image-studio", "Студия картинок", "apps/image-studio", {
    runtimeDependencies: ["core"],
    services: ["image-studio"],
    entrypoint: "apps/image-studio/src/standalone/index.ts",
    healthPath: "/v1/health",
    dataPaths: ["image-studio"],
    contractPaths: [
      "apps/image-studio/src/core.ts",
      "apps/image-studio/src/service.ts",
      "apps/image-studio/src/internal.ts",
      "apps/image-studio/src/index.ts",
    ],
    contractChecks: [
      { workspace: "@voicechat/server", files: ["src/imageStudioBridge"] },
    ],
    isolation: { tests: true, build: true, deploy: true },
  }),
  definition(
    "playwright-reader",
    "Playwright Reader API",
    "apps/playwright-reader",
    {
      browserPaths: ["apps/playwright-reader/src"],
      e2eFiles: ["e2e/playwrightReader.e2e.test.ts"],
      runtimeDependencies: ["core", "browser-runner"],
      services: ["playwright-reader"],
      entrypoint: "apps/playwright-reader/src/standalone/index.ts",
      healthPath: "/v1/health",
      buildDependencies: ["shared", "browser-runner"],
      contractPaths: [
        "apps/playwright-reader/src/core.ts",
        "apps/playwright-reader/src/service.ts",
        "apps/playwright-reader/src/internal.ts",
        "apps/playwright-reader/src/index.ts",
      ],
      contractChecks: [
        {
          workspace: "@voicechat/server",
          files: ["src/playwrightReaderBridge"],
        },
      ],
      isolation: { tests: true, build: true, deploy: true },
    },
  ),
  definition("browser-runner", "Chromium", "apps/browser-runner", {
    browserPaths: ["apps/browser-runner/src"],
    e2eFiles: ["e2e/playwrightReader.e2e.test.ts"],
    services: ["browser-runner"],
    entrypoint: "apps/browser-runner/src/index.ts",
    healthPath: "/v1/health",
    dataPaths: ["browser-profiles"],
    contractPaths: [
      "apps/browser-runner/src/client.ts",
      "apps/browser-runner/src/server.ts",
    ],
    contractChecks: [
      { workspace: "@voicechat/playwright-reader", files: [] },
      {
        workspace: "@voicechat/server",
        files: ["src/browser", "src/playwrightReaderBridge"],
      },
    ],
    isolation: { tests: true, build: true, deploy: true },
  }),
  ...(
    ["llm-runner", "stt-runner", "tts-runner", "automation-runner"] as const
  ).map((id) =>
    definition(id, id, `apps/${id}`, {
      runtimeDependencies:
        id === "automation-runner" ? ["core", "llm-runner"] : [],
      services: id === "llm-runner" ? ["runner-work", "runner-personal"] : [id],
      entrypoint: `apps/${id}/src/index.ts`,
      healthPath: "/v1/health",
      contractPaths: [
        `apps/${id}/src/client.ts`,
        `apps/${id}/src/types.ts`,
        `apps/${id}/src/server.ts`,
      ],
      contractChecks: [
        {
          workspace: "@voicechat/server",
          files:
            id === "llm-runner"
              ? ["src/llm"]
              : id === "automation-runner"
                ? ["src/automationClient.test.ts"]
                : [`src/${id.slice(0, 3)}`],
        },
      ],
      isolation: {
        tests: true,
        build: true,
        deploy: id !== "automation-runner",
      },
    }),
  ),
  definition("web", "Веб-оболочка", "apps/web", {
    e2eFiles: ["e2e/applicationReleases.e2e.test.ts"],
    browserPaths: [
      "packages/ui/src/runtime",
      "packages/ui/src/components/releases/ApplicationReleaseCenter.tsx",
    ],
    paths: ["apps/web", "packages/ui"],
    workspaces: ["@voicechat/ui", "@voicechat/web"],
    buildDependencies: [
      "shared",
      "sessions-core",
      "ui-kit",
      "app-shell",
      "chat-app",
      "admin-app",
      "projects-app",
      "operations-app",
      "profile-app",
      "sessions-app",
      "playwright-reader-ui",
      "web-reader-ui",
      "ui-foundation",
      "make-ui",
      "image-studio-ui",
    ],
    kind: "frontend",
  }),
  definition("web-recorder", "Веб-рекордер", "apps/web-recorder", {
    kind: "frontend",
    buildDependencies: ["shared", "ui-kit", "web"],
  }),
  ...(
    [
      ["make-ui", "Make UI", "make-app", "make"],
      [
        "image-studio-ui",
        "Студия картинок UI",
        "image-studio-app",
        "image-studio",
      ],
      [
        "playwright-reader-ui",
        "Playwright Reader UI",
        "playwright-reader-app",
        "playwright-reader",
      ],
      ["web-reader-ui", "Web Reader UI", "web-reader-app", "core"],
    ] as const
  ).map(([id, name, pkg, backend]) =>
    definition(id, name, `packages/${pkg}`, {
      workspaces: [`@voicechat/${pkg}`],
      kind: "frontend",
      buildDependencies: [
        "shared",
        "ui-kit",
        "ui-foundation",
        ...(id.includes("reader") ? ["chat-app"] : []),
      ],
      runtimeDependencies: [...new Set(["core", backend])],
      services: [id],
      entrypoint: "scripts/application-frontend-server.mjs",
      healthPath: "/v1/health",
      dataPaths: ["frontend-assets"],
      configuration: ["VC_DATA_DIR"],
      frontend: { entry: "src/frontend.tsx" },
      browserPaths: [`packages/${pkg}/src`],
      e2eFiles: ["e2e/applicationFrontend.e2e.test.ts"],
      contractPaths: [`packages/${pkg}/src/panelContract.ts`],
      contractChecks: [
        {
          workspace: "@voicechat/ui",
          files: ["src/runtime/applicationHost.dom.test.tsx"],
        },
      ],
      isolation: { tests: true, build: true, deploy: true },
    }),
  ),
  definition(
    "ui-foundation",
    "Общие инструменты UI",
    "packages/ui-foundation",
    {
      kind: "library",
      buildDependencies: ["shared", "ui-kit"],
      contractPaths: ["packages/ui-foundation/src"],
    },
  ),
  ...(["agent", "desktop", "agent-tray", "login-application"] as const).map(
    (id) =>
      definition(id, id, `apps/${id}`, {
        workspaces: id === "agent" ? ["@voicechat/agent"] : [],
        kind: "client",
        buildDependencies: id === "desktop" ? ["shared", "web"] : ["shared"],
      }),
  ),
  ...(
    [
      "shared",
      "sessions-core",
      "ui-kit",
      "app-shell",
      "sessions-app",
      "profile-app",
      "chat-app",
      "projects-app",
      "operations-app",
      "admin-app",
      "make-contracts",
    ] as const
  ).map((id) =>
    definition(id, id, `packages/${id}`, {
      kind: "library",
      buildDependencies:
        id === "shared"
          ? ["sessions-core"]
          : id === "sessions-core" || id === "ui-kit" || id === "app-shell"
            ? []
            : id === "make-contracts"
              ? ["shared"]
              : id === "sessions-app"
                ? ["sessions-core", "ui-kit"]
                : id === "profile-app"
                  ? ["sessions-app", "ui-kit"]
                  : id === "admin-app"
                    ? ["shared", "ui-kit", "profile-app", "sessions-app"]
                    : ["shared", "ui-kit"],
      contractPaths: [`packages/${id}`],
    }),
  ),
];
export function validateApplicationCatalog(
  catalog: readonly ApplicationDefinition[],
): void {
  const ids = new Set<string>(),
    paths: string[] = [],
    services = new Set<string>();
  for (const app of catalog) {
    if (!APPLICATION_ID_RE.test(app.id) || ids.has(app.id))
      throw new Error(`Повтор или неверный id: ${app.id}`);
    ids.add(app.id);
    for (const path of app.paths) {
      if (
        !/^(apps|packages)\/[a-zA-Z0-9/_-]+$/.test(path) ||
        path.endsWith("/") ||
        paths.some(
          (other) =>
            path === other ||
            path.startsWith(other + "/") ||
            other.startsWith(path + "/"),
        )
      )
        throw new Error(`Пересечение владельцев пути: ${path}`);
      paths.push(path);
    }
    for (const service of app.services) {
      if (!APPLICATION_ID_RE.test(service) || services.has(service))
        throw new Error(`Повтор сервиса: ${service}`);
      services.add(service);
    }
  }
  for (const app of catalog)
    for (const dependency of [
      ...app.buildDependencies,
      ...app.runtimeDependencies,
      ...(app.optionalRuntimeDependencies ?? []),
    ])
      if (!ids.has(dependency))
        throw new Error(`Неизвестная зависимость ${app.id}: ${dependency}`);
}
export function applicationForPath(
  path: string,
  catalog = APPLICATION_CATALOG,
): ApplicationDefinition | undefined {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === ".." || part === ".")
  )
    return undefined;
  const matches = catalog.filter((app) =>
    app.paths.some(
      (prefix) => path === prefix || path.startsWith(prefix + "/"),
    ),
  );
  if (matches.length > 1) throw new Error(`Несколько владельцев ${path}`);
  return matches[0];
}
/** Манифест не может захватить чужой сервис или скрыть обязательную зависимость. */
export function validateCatalogArtifact(
  manifest: ApplicationReleaseManifest,
  catalog = APPLICATION_CATALOG,
): ApplicationDefinition {
  const app = catalog.find((item) => item.id === manifest.applicationId);
  if (!app) throw new Error(`Нет приложения ${manifest.applicationId}`);
  if (
    app.services.length !== manifest.artifacts.length ||
    manifest.artifacts.some(
      (artifact) => !app.services.includes(artifact.service),
    )
  )
    throw new Error("Артефакты не соответствуют сервисам приложения");
  for (const dependency of app.runtimeDependencies) {
    const requirement = manifest.requires.find(
      (item) => item.applicationId === dependency,
    );
    if (
      !requirement ||
      requirement.optional ||
      !requirement.minApiVersion ||
      !requirement.maxApiVersionExclusive
    )
      throw new Error(`Нужен обязательный диапазон версии и API ${dependency}`);
  }
  for (const dependency of app.optionalRuntimeDependencies ?? []) {
    const requirement = manifest.requires.find(
      (item) => item.applicationId === dependency,
    );
    if (!requirement?.minApiVersion || !requirement.maxApiVersionExclusive)
      throw new Error(
        `Нужен снимок поддерживаемой версии и API опционального сервиса ${dependency}`,
      );
  }
  for (const requirement of manifest.requires)
    if (
      !catalog.some(
        (item) =>
          item.id === requirement.applicationId && item.kind !== "library",
      )
    )
      throw new Error(
        `Неизвестная runtime-зависимость ${requirement.applicationId}`,
      );
  return app;
}

export function validateCatalogRelease(
  manifest: ApplicationReleaseManifest,
  catalog = APPLICATION_CATALOG,
): ApplicationDefinition {
  const app = validateCatalogArtifact(manifest, catalog);
  if (!app.isolation.deploy)
    throw new Error(`Нет независимого deploy для ${manifest.applicationId}`);
  return app;
}
