import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getWebBuildVersion } from "./build-version.mjs";

test("bundles the release version plus the actual web source revision, never client package 1.0.0", () => {
    assert.equal(getWebBuildVersion({ releaseVersion: "3.0.79", revision: "abcdef0123456789" }), "3.0.79+web.abcdef012345");
    assert.equal(getWebBuildVersion({ releaseVersion: "3.0.80", revision: "123456abcdef" }), "3.0.80+web.123456abcdef");
    assert.throws(() => getWebBuildVersion({ releaseVersion: "bad", revision: "abcdef" }));
});

test("the containerized frontend build receives release metadata and the source revision", () => {
    const dockerfile = fs.readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
    assert.match(dockerfile, /COPY desktop\/package\.json \/app\/desktop\/package\.json/);
    assert.match(dockerfile, /ARG RAILWAY_GIT_COMMIT_SHA/);
    assert.ok(dockerfile.indexOf("COPY desktop/package.json") < dockerfile.indexOf("RUN npm run build"));
});
