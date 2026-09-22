// Один каталог связывает владельцев кода, гейты и артефакты. Runtime-зависимости
// версионируются внутри выпуска, а не выводятся из npm-зависимостей исходников.
import {
  APPLICATION_ID_RE,
  compareApplicationVersions,
  type ApplicationReleaseManifest,
} from "./applicationRelease";
export interface ApplicationDefinition {
  id: string;
  name: string;
  external?: { repository: string; package: string };
  paths: string[];
  workspaces: string[];
  buildDependencies: string[];
  runtimeDependencies: string[];
  optionalRuntimeDependencies?: string[];
  minimumDependencyApis?: Record<string, string>;
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
const definition = (id: string, name: string, paths: string[], options: Partial<ApplicationDefinition> = {}): ApplicationDefinition => ({
  id, name, paths, workspaces: [`@voicechat/${id}`], buildDependencies: ['shared'],
  runtimeDependencies: [], browserPaths: [], e2eFiles: [], contractPaths: [], contractChecks: [],
  services: [], dataPaths: [], configuration: [], kind: 'service',
  isolation: { tests: false, build: false, deploy: false }, ...options
});
function createApplicationCatalog(): readonly ApplicationDefinition[] {
  return [
  definition("core", "Ядро", ["apps/server"], {
    "workspaces": [
      "@voicechat/server"
    ],
    "buildDependencies": [
      "platform-sdk",
      "identity",
      "identity-client",
      "identity-contracts",
      "storage-sql",
      "component-runtime",
      "shared",
      "sessions-core",
      "make-contracts",
      "web-reader-contracts",
      "playwright-reader-contracts",
      "make",
      "image-studio",
      "web-reader",
      "playwright-reader",
      "browser-runner",
      "llm-runner"
    ],
    "services": [
      "voicechat"
    ],
    "dataPaths": [
      "database",
      "users",
      "conversations",
      "chat-accounting.sqlite"
    ],
    "isolation": {
      "tests": false,
      "build": true,
      "deploy": false
    },
    "optionalRuntimeDependencies": [
      "identity",
      "billing",
      "make",
      "image-studio",
      "web-reader",
      "playwright-reader",
      "browser-runner",
      "llm-runner",
      "stt-runner",
      "tts-runner",
      "make-ui",
      "image-studio-ui",
      "playwright-reader-ui",
      "web-reader-ui"
    ],
    "entrypoint": "apps/server/src/index.ts",
    "healthPath": "/api/health"
  }),
  definition("identity", "Identity", [], {
    "workspaces": [],
    "buildDependencies": [],
    "contractChecks": [
      {
        "workspace": "@voicechat/server",
        "files": [
          "src/routes/rest.auth.test.ts",
          "src/routes/internal.component.test.ts",
          "src/identityBridge.test.ts"
        ]
      }
    ],
    "services": [
      "identity"
    ],
    "dataPaths": [
      "identity"
    ],
    "configuration": [
      "SISLEXA_COMPONENT_CONFIG",
      "IDENTITY_DATABASE_URL",
      "IDENTITY_SESSION_SECRET_FILE"
    ],
    "isolation": {
      "tests": false,
      "build": false,
      "deploy": true
    },
    "optionalRuntimeDependencies": [
      "core"
    ],
    "healthPath": "/v1/health",
    "external": {
      "repository": "https://github.com/sislex/identity",
      "package": "@sislexa/identity"
    }
  }),
  definition("billing", "Billing", [], {
    "workspaces": [],
    "buildDependencies": [],
    "runtimeDependencies": [
      "identity"
    ],
    "contractChecks": [
      {
        "workspace": "@voicechat/server",
        "files": [
          "src/billingBridge.test.ts"
        ]
      }
    ],
    "services": [
      "billing"
    ],
    "dataPaths": [
      "billing"
    ],
    "configuration": [
      "SISLEXA_COMPONENT_CONFIG",
      "BILLING_DATA_DIR"
    ],
    "isolation": {
      "tests": false,
      "build": false,
      "deploy": true
    },
    "minimumDependencyApis": {
      "identity": "1.1.0"
    },
    "healthPath": "/api/health",
    "external": {
      "repository": "https://github.com/sislex/billing",
      "package": "@sislexa/billing"
    }
  }),
  definition("platform-sdk", "Platform SDK", [], {
    "workspaces": [],
    "buildDependencies": [],
    "kind": "library",
    "external": {
      "repository": "https://github.com/sislex/sdk",
      "package": "@sislexa/sdk"
    }
  }),
  definition("make", "Make", [], {
    "workspaces": [],
    "buildDependencies": [],
    "runtimeDependencies": [
      "core"
    ],
    "e2eFiles": [
      "e2e/make.e2e.test.ts"
    ],
    "contractChecks": [
      {
        "workspace": "@voicechat/server",
        "files": [
          "src/makeBridge"
        ]
      }
    ],
    "services": [
      "make"
    ],
    "dataPaths": [
      "make"
    ],
    "configuration": [
      "VC_CORE_URL",
      "VC_INTERNAL_TOKEN",
      "VC_MCP_SECRET",
      "VC_DATA_DIR"
    ],
    "isolation": {
      "tests": false,
      "build": false,
      "deploy": true
    },
    "healthPath": "/v1/health",
    "external": {
      "repository": "https://github.com/sislex/make",
      "package": "@sislexa/make"
    }
  }),
  definition("image-studio", "Студия картинок", [], {
    "workspaces": [],
    "buildDependencies": [],
    "runtimeDependencies": [
      "core"
    ],
    "contractChecks": [
      {
        "workspace": "@voicechat/server",
        "files": [
          "src/imageStudioBridge"
        ]
      }
    ],
    "services": [
      "image-studio"
    ],
    "dataPaths": [
      "image-studio"
    ],
    "isolation": {
      "tests": false,
      "build": false,
      "deploy": true
    },
    "healthPath": "/v1/health",
    "external": {
      "repository": "https://github.com/sislex/image-studio",
      "package": "@sislexa/image-studio"
    }
  }),
  definition("playwright-reader", "Playwright Reader API", [], {
    "workspaces": [],
    "buildDependencies": [],
    "runtimeDependencies": [
      "core",
      "browser-runner"
    ],
    "e2eFiles": [
      "e2e/playwrightReader.e2e.test.ts"
    ],
    "contractChecks": [
      {
        "workspace": "@voicechat/server",
        "files": [
          "src/playwrightReaderBridge"
        ]
      }
    ],
    "services": [
      "playwright-reader"
    ],
    "isolation": {
      "tests": false,
      "build": false,
      "deploy": true
    },
    "healthPath": "/v1/health",
    "external": {
      "repository": "https://github.com/sislex/playwrightreader",
      "package": "@sislexa/playwright-reader"
    }
  }),
  definition("browser-runner", "Chromium", [], {
    "workspaces": [],
    "buildDependencies": [],
    "e2eFiles": [
      "e2e/playwrightReader.e2e.test.ts"
    ],
    "contractChecks": [
      {
        "workspace": "@voicechat/playwright-reader",
        "files": []
      },
      {
        "workspace": "@voicechat/server",
        "files": [
          "src/browser",
          "src/playwrightReaderBridge"
        ]
      }
    ],
    "services": [
      "browser-runner"
    ],
    "dataPaths": [
      "browser-profiles"
    ],
    "isolation": {
      "tests": false,
      "build": false,
      "deploy": true
    },
    "healthPath": "/v1/health",
    "external": {
      "repository": "https://github.com/sislex/playwrightreader",
      "package": "@sislexa/playwright-reader"
    }
  }),
  definition("llm-runner", "LLM Runner", [], {
    workspaces: [], buildDependencies: [], contractPaths: [],
    contractChecks: [{ workspace: '@voicechat/server', files: ['src/llm'] }],
    services: ['runner-work', 'runner-personal'],
    isolation: { tests: false, build: false, deploy: true },
    healthPath: '/v1/health',
    external: { repository: 'https://github.com/sislex/llm-runner', package: '@sislex/llm-runner' }
  }),
  definition("stt-runner", "stt-runner", [], {
    "workspaces": [],
    "buildDependencies": [],
    "contractChecks": [
      {
        "workspace": "@voicechat/server",
        "files": [
          "src/stt"
        ]
      }
    ],
    "services": [
      "stt-runner"
    ],
    "isolation": {
      "tests": false,
      "build": false,
      "deploy": true
    },
    "healthPath": "/v1/health",
    "external": {
      "repository": "https://github.com/sislex/voice",
      "package": "@sislexa/voice"
    }
  }),
  definition("tts-runner", "tts-runner", [], {
    "workspaces": [],
    "buildDependencies": [],
    "contractChecks": [
      {
        "workspace": "@voicechat/server",
        "files": [
          "src/tts"
        ]
      }
    ],
    "services": [
      "tts-runner"
    ],
    "isolation": {
      "tests": false,
      "build": false,
      "deploy": true
    },
    "healthPath": "/v1/health",
    "external": {
      "repository": "https://github.com/sislex/voice",
      "package": "@sislexa/voice"
    }
  }),
  definition("automation-runner", "automation-runner", ["apps/automation-runner"], {
    "runtimeDependencies": [
      "core",
      "llm-runner"
    ],
    "contractPaths": [
      "apps/automation-runner/src/client.ts",
      "apps/automation-runner/src/types.ts",
      "apps/automation-runner/src/server.ts"
    ],
    "contractChecks": [
      {
        "workspace": "@voicechat/server",
        "files": [
          "src/automationClient.test.ts"
        ]
      }
    ],
    "services": [
      "automation-runner"
    ],
    "isolation": {
      "tests": true,
      "build": true,
      "deploy": false
    },
    "entrypoint": "apps/automation-runner/src/index.ts",
    "healthPath": "/v1/health"
  }),
  definition("web", "Веб-оболочка", ["apps/web","packages/ui"], {
    "workspaces": [
      "@voicechat/ui",
      "@voicechat/web"
    ],
    "buildDependencies": [
      "shared",
      "sessions-core",
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
      "voice-browser",
      "identity-login",
      "identity-account",
      "identity-client",
      "make-ui",
      "image-studio-ui"
    ],
    "browserPaths": [
      "e2e/sessions.e2e.test.ts",
      "e2e/settings.e2e.test.ts",
      "e2e/projects.e2e.test.ts",
      "e2e/gitPane.e2e.test.ts",
      "packages/ui/src/runtime",
      "packages/ui/src/App.tsx",
      "packages/ui/src/styles",
      "e2e/accessibility.e2e.test.ts",
      "packages/ui/src/test/accessibilityBrowser.tsx",
      "packages/ui/src/components/releases/ApplicationReleaseCenter.tsx",
      "packages/ui/src/components/MachineVpn.tsx",
      "packages/ui/src/components/MachineVpn.css",
      "packages/ui/src/components/MachineVpn.stories.tsx",
      "packages/ui/src/test/fixtures/vpn.ts",
      "e2e/machine-vpn.e2e.test.ts",
      "e2e/universalSearch.e2e.test.ts",
      "packages/ui/src/components/CommandPalette.tsx",
      "packages/ui/src/lib/useUniversalSearch.ts"
    ],
    "e2eFiles": [
      "e2e/sessions.e2e.test.ts",
      "e2e/settings.e2e.test.ts",
      "e2e/projects.e2e.test.ts",
      "e2e/gitPane.e2e.test.ts",
      "e2e/applicationReleases.e2e.test.ts",
      "e2e/accessibility.e2e.test.ts",
      "e2e/machine-vpn.e2e.test.ts",
      "e2e/universalSearch.e2e.test.ts"
    ],
    "kind": "frontend"
  }),
  definition("web-reader", "Web Reader", [], {
    "workspaces": [],
    "buildDependencies": [],
    "runtimeDependencies": [
      "core",
      "playwright-reader"
    ],
    "e2eFiles": [
      "e2e/webReaderHttp.e2e.test.ts",
      "e2e/webReaderModel.e2e.test.ts",
      "e2e/webReaderNative.e2e.test.ts",
      "e2e/webReaderOwnProject.e2e.test.ts",
      "e2e/webReaderProject.e2e.test.ts"
    ],
    "contractChecks": [
      {
        "workspace": "@voicechat/server",
        "files": [
          "src/readerBridge",
          "src/playwrightReaderBridge"
        ]
      }
    ],
    "services": [
      "web-reader"
    ],
    "configuration": [
      "VC_CORE_URL",
      "VC_INTERNAL_TOKEN",
      "VC_MCP_SECRET",
      "VC_PLAYWRIGHT_READER_URL",
      "VC_BROWSER_HOST_ALIASES"
    ],
    "isolation": {
      "tests": false,
      "build": false,
      "deploy": true
    },
    "minimumDependencyApis": {
      "core": "1.1.0"
    },
    "healthPath": "/v1/health",
    "external": {
      "repository": "https://github.com/sislex/webreader",
      "package": "@sislexa/web-reader"
    }
  }),
  definition("make-ui", "Make UI", [], {
    "workspaces": [],
    "buildDependencies": [],
    "runtimeDependencies": [
      "core",
      "make"
    ],
    "e2eFiles": [
      "e2e/applicationFrontend.e2e.test.ts"
    ],
    "contractChecks": [
      {
        "workspace": "@voicechat/ui",
        "files": [
          "src/runtime/applicationHost.dom.test.tsx"
        ]
      }
    ],
    "services": [
      "make-ui"
    ],
    "dataPaths": [
      "frontend-assets"
    ],
    "configuration": [
      "VC_DATA_DIR"
    ],
    "isolation": {
      "tests": false,
      "build": false,
      "deploy": true
    },
    "kind": "frontend",
    "healthPath": "/v1/health",
    "frontend": {
      "entry": "src/frontend.tsx"
    },
    "external": {
      "repository": "https://github.com/sislex/make",
      "package": "@sislexa/make"
    }
  }),
  definition("image-studio-ui", "Студия картинок UI", [], {
    "workspaces": [],
    "buildDependencies": [],
    "runtimeDependencies": [
      "core",
      "image-studio"
    ],
    "e2eFiles": [
      "e2e/applicationFrontend.e2e.test.ts",
      "e2e/imageStudioLayout.e2e.test.ts"
    ],
    "contractChecks": [
      {
        "workspace": "@voicechat/ui",
        "files": [
          "src/runtime/applicationHost.dom.test.tsx"
        ]
      }
    ],
    "services": [
      "image-studio-ui"
    ],
    "dataPaths": [
      "frontend-assets"
    ],
    "configuration": [
      "VC_DATA_DIR"
    ],
    "isolation": {
      "tests": false,
      "build": false,
      "deploy": true
    },
    "kind": "frontend",
    "healthPath": "/v1/health",
    "frontend": {
      "entry": "src/frontend.tsx"
    },
    "external": {
      "repository": "https://github.com/sislex/image-studio",
      "package": "@sislexa/image-studio"
    }
  }),
  definition("playwright-reader-ui", "Playwright Reader UI", [], {
    "workspaces": [],
    "buildDependencies": [],
    "runtimeDependencies": [
      "core",
      "playwright-reader"
    ],
    "e2eFiles": [
      "e2e/applicationFrontend.e2e.test.ts"
    ],
    "contractChecks": [
      {
        "workspace": "@voicechat/ui",
        "files": [
          "src/runtime/applicationHost.dom.test.tsx"
        ]
      }
    ],
    "services": [
      "playwright-reader-ui"
    ],
    "dataPaths": [
      "frontend-assets"
    ],
    "configuration": [
      "VC_DATA_DIR"
    ],
    "isolation": {
      "tests": false,
      "build": false,
      "deploy": true
    },
    "kind": "frontend",
    "healthPath": "/v1/health",
    "frontend": {
      "entry": "src/frontend.tsx"
    },
    "external": {
      "repository": "https://github.com/sislex/playwrightreader",
      "package": "@sislexa/playwright-reader"
    }
  }),
  definition("web-reader-ui", "Web Reader UI", [], {
    "workspaces": [],
    "buildDependencies": [],
    "runtimeDependencies": [
      "core",
      "web-reader"
    ],
    "e2eFiles": [
      "e2e/applicationFrontend.e2e.test.ts"
    ],
    "contractChecks": [
      {
        "workspace": "@voicechat/ui",
        "files": [
          "src/runtime/applicationHost.dom.test.tsx"
        ]
      }
    ],
    "services": [
      "web-reader-ui"
    ],
    "dataPaths": [
      "frontend-assets"
    ],
    "configuration": [
      "VC_DATA_DIR"
    ],
    "isolation": {
      "tests": false,
      "build": false,
      "deploy": true
    },
    "kind": "frontend",
    "healthPath": "/v1/health",
    "frontend": {
      "entry": "src/frontend.tsx"
    },
    "external": {
      "repository": "https://github.com/sislex/webreader",
      "package": "@sislexa/web-reader"
    }
  }),
  definition("ui-kit", "ui-kit", [], {
    "workspaces": [],
    "buildDependencies": [],
    "kind": "library",
    "external": {
      "repository": "https://github.com/sislex/sielexa-ui",
      "package": "@voicechat/ui-kit"
    }
  }),
  definition("ui-foundation", "ui-foundation", [], {
    "workspaces": [],
    "buildDependencies": [],
    "kind": "library",
    "external": {
      "repository": "https://github.com/sislex/sielexa-ui",
      "package": "@voicechat/ui-foundation"
    }
  }),
  definition("agent", "agent", ["apps/agent"], {
    "kind": "client"
  }),
  definition("desktop", "desktop", ["apps/desktop"], {
    "workspaces": [],
    "buildDependencies": [
      "shared",
      "web"
    ],
    "kind": "client"
  }),
  definition("agent-tray", "agent-tray", ["apps/agent-tray"], {
    "workspaces": [],
    "kind": "client"
  }),
  definition("login-application", "login-application", ["apps/login-application"], {
    "workspaces": [],
    "kind": "client"
  }),
  definition("component-runtime", "Component runtime", ["packages/component-runtime"], {
    "workspaces": [
      "@sislexa/component-runtime"
    ],
    "contractPaths": [
      "packages/component-runtime"
    ],
    "kind": "library"
  }),
  definition("shared", "shared", ["packages/shared"], {
    "buildDependencies": [
      "sessions-core"
    ],
    "contractPaths": [
      "packages/shared"
    ],
    "kind": "library"
  }),
  definition("identity-client", "identity-client", [], {
    "workspaces": [],
    "buildDependencies": [],
    "kind": "library",
    "external": {
      "repository": "https://github.com/sislex/identity",
      "package": "@sislexa/identity"
    }
  }),
  definition("identity-contracts", "identity-contracts", [], {
    "workspaces": [],
    "buildDependencies": [],
    "kind": "library",
    "external": {
      "repository": "https://github.com/sislex/identity",
      "package": "@sislexa/identity"
    }
  }),
  definition("identity-login", "identity-login", [], {
    "workspaces": [],
    "buildDependencies": [],
    "kind": "library",
    "external": {
      "repository": "https://github.com/sislex/identity",
      "package": "@sislexa/identity"
    }
  }),
  definition("identity-account", "identity-account", [], {
    "workspaces": [],
    "buildDependencies": [],
    "kind": "library",
    "external": {
      "repository": "https://github.com/sislex/identity",
      "package": "@sislexa/identity"
    }
  }),
  definition("storage-sql", "storage-sql", [], {
    "workspaces": [],
    "buildDependencies": [],
    "kind": "library",
    "external": {
      "repository": "https://github.com/sislex/identity",
      "package": "@sislexa/identity"
    }
  }),
  definition("sessions-core", "sessions-core", [], {
    "workspaces": [],
    "buildDependencies": [],
    "kind": "library",
    "external": {
      "repository": "https://github.com/sislex/identity",
      "package": "@sislexa/identity"
    }
  }),
  definition("voice-browser", "voice-browser", [], {
    "workspaces": [],
    "buildDependencies": [],
    "kind": "library",
    "external": {
      "repository": "https://github.com/sislex/voice",
      "package": "@sislexa/voice"
    }
  }),
  definition("app-shell", "app-shell", ["packages/app-shell"], {
    "buildDependencies": [],
    "contractPaths": [
      "packages/app-shell"
    ],
    "kind": "library"
  }),
  definition("sessions-app", "sessions-app", [], {
    "workspaces": [],
    "buildDependencies": [],
    "kind": "library",
    "external": {
      "repository": "https://github.com/sislex/identity",
      "package": "@sislexa/identity"
    }
  }),
  definition("profile-app", "profile-app", [], {
    "workspaces": [],
    "buildDependencies": [],
    "kind": "library",
    "external": {
      "repository": "https://github.com/sislex/identity",
      "package": "@sislexa/identity"
    }
  }),
  definition("chat-app", "chat-app", ["packages/chat-app"], {
    "buildDependencies": [
      "shared",
      "ui-kit"
    ],
    "contractPaths": [
      "packages/chat-app"
    ],
    "kind": "library"
  }),
  definition("projects-app", "projects-app", ["packages/projects-app"], {
    "buildDependencies": [
      "shared",
      "ui-kit"
    ],
    "contractPaths": [
      "packages/projects-app"
    ],
    "kind": "library"
  }),
  definition("operations-app", "operations-app", ["packages/operations-app"], {
    "buildDependencies": [
      "shared",
      "ui-kit"
    ],
    "contractPaths": [
      "packages/operations-app"
    ],
    "kind": "library"
  }),
  definition("admin-app", "admin-app", ["packages/admin-app"], {
    "buildDependencies": [
      "shared",
      "ui-kit",
      "profile-app",
      "sessions-app"
    ],
    "contractPaths": [
      "packages/admin-app"
    ],
    "kind": "library"
  }),
  definition("make-contracts", "make-contracts", [], {
    "workspaces": [],
    "buildDependencies": [],
    "kind": "library",
    "external": {
      "repository": "https://github.com/sislex/make",
      "package": "@voicechat/make-contracts"
    }
  }),
  definition("browser-contracts", "browser-contracts", [], {
    "workspaces": [],
    "buildDependencies": [],
    "e2eFiles": [
      "e2e/webReaderNative.e2e.test.ts"
    ],
    "kind": "library",
    "external": {
      "repository": "https://github.com/sislex/playwrightreader",
      "package": "@voicechat/browser-contracts"
    }
  }),
  definition("web-reader-contracts", "web-reader-contracts", [], {
    "workspaces": [],
    "buildDependencies": [],
    "kind": "library",
    "external": {
      "repository": "https://github.com/sislex/webreader",
      "package": "@voicechat/web-reader-contracts"
    }
  }),
  definition("playwright-reader-contracts", "playwright-reader-contracts", [], {
    "workspaces": [],
    "buildDependencies": [],
    "kind": "library",
    "external": {
      "repository": "https://github.com/sislex/playwrightreader",
      "package": "@voicechat/playwright-reader-contracts"
    }
  })
  ];
}
// Allow clients that only import other shared contracts to omit release tooling metadata.
export const APPLICATION_CATALOG = /* @__PURE__ */ createApplicationCatalog();
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
  if (matches[0]) return matches[0];
  // Shared E2E suites retain the conservative full-gate fallback.
  const e2eOwners = catalog.filter(
    (app) => app.e2eFiles.includes(path) && app.browserPaths.includes(path),
  );
  return e2eOwners.length === 1 ? e2eOwners[0] : undefined;
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
    const minimum = app.minimumDependencyApis?.[dependency];
    if (minimum && compareApplicationVersions(requirement.minApiVersion, minimum) < 0)
      throw new Error(`${app.id} требует API ${dependency} не ниже ${minimum}`);
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
