import { describe, expect, it } from "vitest";
import {
  applicationCompatibility,
  applicationVersion,
  applicationVersionMatches,
  compareApplicationVersions,
  parseApplicationEnvironment,
  parseApplicationReleaseBranch,
  parseApplicationReleaseManifest,
  type ApplicationEnvironment,
  type ApplicationReleaseManifest,
} from "./applicationRelease";
import {
  APPLICATION_CATALOG,
  applicationForPath,
  validateApplicationCatalog,
} from "./applicationCatalog";
const manifest = (
  id: string,
  over: Partial<ApplicationReleaseManifest> = {},
): ApplicationReleaseManifest => ({
  schemaVersion: 1,
  applicationId: id,
  version: "1.2.0",
  apiVersion: "1.0.0",
  commit: "a".repeat(40),
  artifacts: [
    {
      kind: "oci",
      service: id,
      reference: "registry.test/" + id + "@sha256:" + "b".repeat(64),
    },
  ],
  requires: [],
  capabilities: [],
  dataVersion: "1.0.0",
  ...over,
});
const requirement = {
  applicationId: "core",
  minVersion: "1.1.0",
  maxVersionExclusive: "2.0.0",
  minApiVersion: "1.0.0",
  maxApiVersionExclusive: "2.0.0",
};
const environment = (
  ...apps: ApplicationReleaseManifest[]
): ApplicationEnvironment => ({
  schemaVersion: 1,
  revision: 7,
  applications: apps.map((manifest) => ({
    manifest,
    healthy: true,
    installedAt: 1,
  })),
});
describe("совместимость самостоятельных выпусков", () => {
  it("сравнивает версии по числам и отвергает неоднозначные значения", () => {
    expect(compareApplicationVersions("1.10.0", "1.9.0")).toBe(1);
    for (const value of [
      "1.01.0",
      "v1.2.3",
      "1.0",
      "1.0.0-beta",
      "9007199254740992.0.0",
      "1.0.0\n",
    ])
      expect(applicationVersion(value), value).toBe(false);
    expect(applicationVersionMatches("1.1.0", "1.1.0", "2.0.0")).toBe(true);
    expect(applicationVersionMatches("2.0.0", "1.1.0", "2.0.0")).toBe(false);
  });
  it("различает legacy и компонентную ветки", () => {
    expect(parseApplicationReleaseBranch("release/1.2.3")).toEqual({
      applicationId: null,
      version: "1.2.3",
    });
    expect(parseApplicationReleaseBranch("release/make/1.2.3")).toEqual({
      applicationId: "make",
      version: "1.2.3",
    });
    for (const branch of [
      "release/make/01.2.3",
      "release/../1.2.3",
      "release/make/1.2.3/extra",
    ])
      expect(parseApplicationReleaseBranch(branch)).toBeNull();
  });
  it("проверяет минимальную и верхнюю версии зависимости", () => {
    const make = manifest("make", { requires: [requirement] });
    expect(
      applicationCompatibility(environment(manifest("core")), [make]),
    ).toEqual([]);
    expect(
      applicationCompatibility(
        environment(manifest("core", { version: "1.0.0" })),
        [make],
      ),
    ).toEqual([expect.objectContaining({ code: "version" })]);
    expect(
      applicationCompatibility(
        environment(manifest("core", { version: "2.0.0" })),
        [make],
      ),
    ).toEqual([expect.objectContaining({ code: "version" })]);
    expect(applicationCompatibility(environment(), [make])).toEqual([
      expect.objectContaining({ code: "missing" }),
    ]);
  });
  it("обновление ядра проверяет ограничения уже установленного Make", () => {
    const current = environment(
      manifest("core"),
      manifest("make", { requires: [requirement] }),
    );
    expect(
      applicationCompatibility(current, [
        manifest("core", { version: "2.0.0" }),
      ]),
    ).toEqual([
      expect.objectContaining({
        applicationId: "make",
        dependencyId: "core",
        code: "version",
      }),
    ]);
  });
  it("проверяет API и возможности независимо от версии реализации", () => {
    const make = manifest("make", {
      requires: [{ ...requirement, capabilities: ["rpc.make"] }],
    });
    expect(
      applicationCompatibility(
        environment(manifest("core", { apiVersion: "2.0.0" })),
        [make],
      ).map((item) => item.code),
    ).toEqual(["api", "capability"]);
  });
  it("optional допускает отсутствие, но не несовместимую установленную версию", () => {
    const make = manifest("make", {
      requires: [{ ...requirement, optional: true }],
    });
    expect(applicationCompatibility(environment(), [make])).toEqual([]);
    expect(
      applicationCompatibility(
        environment(manifest("core", { version: "2.0.0" })),
        [make],
      ),
    ).toHaveLength(1);
  });
  it("проверяет здоровье и запрещает неявный откат формата данных", () => {
    const current = environment(manifest("core"), manifest("make"));
    current.applications[0].healthy = false;
    expect(
      applicationCompatibility(current, [
        manifest("make", { dataVersion: "0.9.0", requires: [requirement] }),
      ]).map((item) => item.code),
    ).toEqual(["data", "unhealthy"]);
  });
  it("согласованный набор допускает взаимные требования новых версий", () => {
    const core = manifest("core", {
      version: "2.0.0",
      requires: [
        {
          applicationId: "make",
          minVersion: "2.0.0",
          maxVersionExclusive: "3.0.0",
        },
      ],
    });
    const make = manifest("make", {
      version: "2.0.0",
      requires: [
        {
          applicationId: "core",
          minVersion: "2.0.0",
          maxVersionExclusive: "3.0.0",
        },
      ],
    });
    expect(
      applicationCompatibility(
        environment(manifest("core"), manifest("make")),
        [core, make],
      ),
    ).toEqual([]);
  });
  it("отвергает изменяемый тег, пустой диапазон, повтор и неизвестную схему", () => {
    expect(() =>
      parseApplicationReleaseManifest({
        ...manifest("make"),
        artifacts: [{ kind: "oci", service: "make", reference: "make:latest" }],
      }),
    ).toThrow(/digest/);
    expect(() =>
      parseApplicationReleaseManifest(
        manifest("make", {
          requires: [{ ...requirement, minVersion: "2.0.0" }],
        }),
      ),
    ).toThrow(/Диапазон/);
    expect(() =>
      parseApplicationReleaseManifest({
        ...manifest("make"),
        schemaVersion: 2,
      }),
    ).toThrow(/схема/);
    expect(() =>
      parseApplicationEnvironment(
        environment(manifest("make"), manifest("make")),
      ),
    ).toThrow(/Повтор/);
    expect(() =>
      applicationCompatibility(environment(), [
        manifest("make"),
        manifest("make"),
      ]),
    ).toThrow(/Повтор/);
  });
  it("не позволяет двум приложениям владеть одним сервисом", () => {
    expect(() =>
      applicationCompatibility(environment(manifest("core")), [
        manifest("make", { artifacts: manifest("core").artifacts }),
      ]),
    ).toThrow(/Сервис/);
  });
});
describe("каталог владельцев", () => {
  it("имеет однозначные пути и разрешимые зависимости", () => {
    expect(() => validateApplicationCatalog(APPLICATION_CATALOG)).not.toThrow();
    expect(applicationForPath("apps/make/src/routes.ts")?.id).toBe("make");
    expect(applicationForPath("packages/ui/src/App.tsx")?.id).toBe("web");
    expect(
      applicationForPath("apps/make/../server/src/index.ts"),
    ).toBeUndefined();
    expect(applicationForPath("apps/new-product/index.ts")).toBeUndefined();
  });
  it("отвергает повторяющееся и вложенное владение", () => {
    expect(() =>
      validateApplicationCatalog([
        ...APPLICATION_CATALOG,
        { ...APPLICATION_CATALOG[1], id: "other", paths: ["apps/make/src"] },
      ]),
    ).toThrow(/Пересечение/);
    expect(() =>
      validateApplicationCatalog([
        ...APPLICATION_CATALOG,
        APPLICATION_CATALOG[0],
      ]),
    ).toThrow(/Повтор/);
  });
});
it("отдельный полный SHA приложения приоритетнее legacy-метаданных проекта", async () => {
  const { applicationRuntimeMetadata } = await import("./applicationRelease");
  expect(
    applicationRuntimeMetadata("make", {
      VC_APPLICATION_COMMIT: "a".repeat(40),
      VC_RELEASE_COMMIT: "legacy-short",
    }).commit,
  ).toBe("a".repeat(40));
  expect(
    APPLICATION_CATALOG.find((app) => app.id === "automation-runner")?.isolation
      .deploy,
  ).toBe(false);
});
it("baseline ядра фиксирует ограничения опциональных потребителей, чтобы новый API приложения не обходил reverse check", async () => {
  const { validateCatalogArtifact } = await import("./applicationCatalog");
  const core = manifest("core");
  core.artifacts[0]!.service = "voicechat";
  expect(() => validateCatalogArtifact(core)).toThrow("опционального");
  core.requires = APPLICATION_CATALOG.find(
    (app) => app.id === "core",
  )!.optionalRuntimeDependencies!.map((applicationId) => ({
    ...requirement,
    applicationId,
    optional: true,
  }));
  expect(validateCatalogArtifact(core).id).toBe("core");
  expect(
    applicationCompatibility(environment(core), [
      manifest("make", { apiVersion: "2.0.0" }),
    ]),
  ).toContainEqual(
    expect.objectContaining({
      applicationId: "core",
      dependencyId: "make",
      code: "api",
    }),
  );
});

it("UI-выпуск фиксирует требования и к оболочке, и к backend приложения", async () => {
  const { validateCatalogRelease } = await import("./applicationCatalog");
  const panel = manifest("make-ui", {
    requires: [{ ...requirement, applicationId: "make" }],
  });
  expect(() => validateCatalogRelease(panel)).toThrow(/core/);
  panel.requires.push(requirement);
  expect(validateCatalogRelease(panel).id).toBe("make-ui");
});
