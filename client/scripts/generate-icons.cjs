/**
 * Generate the web client's PWA / favicon assets from the SAME source artwork
 * the desktop .exe and mobile app use (`desktop/icons/icon-source.svg`). This
 * keeps the browser-tab favicon and installed-PWA icon visually identical to
 * the native builds.
 *
 * Run from the repo root or from client/:
 *   node client/scripts/generate-icons.cjs
 *
 * Requires `sharp` + `png-to-ico`. Both are installed in the desktop
 * workspace, so we resolve them from there (falling back to a local install) to
 * avoid adding heavyweight native dependencies to the client package.
 */
const path = require("path");
const fs = require("fs");

const REPO_ROOT = path.join(__dirname, "..", "..");
const DESKTOP_MODULES = path.join(REPO_ROOT, "desktop", "node_modules");

function resolveDep(name) {
    try {
        return require(name);
    } catch {
        return require(path.join(DESKTOP_MODULES, name));
    }
}

const sharp = resolveDep("sharp");
const pngToIco = resolveDep("png-to-ico");

const SOURCE_PATH = path.join(REPO_ROOT, "desktop", "icons", "icon-source.svg");
const MASKABLE_PATH = path.join(REPO_ROOT, "desktop", "icons", "icon-maskable.svg");
const PUBLIC_DIR = path.join(__dirname, "..", "public");

async function generate() {
    if (!fs.existsSync(SOURCE_PATH)) {
        throw new Error(`Source artwork not found: ${SOURCE_PATH}`);
    }
    if (!fs.existsSync(PUBLIC_DIR)) {
        fs.mkdirSync(PUBLIC_DIR, { recursive: true });
    }
    const source = fs.readFileSync(SOURCE_PATH);

    // 1. PWA / apple-touch icons referenced from manifest.json + index.html.
    for (const size of [192, 512]) {
        await sharp(source)
            .resize(size, size, { fit: "cover", kernel: "lanczos3" })
            .png()
            .toFile(path.join(PUBLIC_DIR, `icon-${size}.png`));
        console.log(`  ✓ icon-${size}.png`);
    }

    // Full-bleed variant for `purpose: "maskable"`, so Android/ChromeOS masks
    // crop background rather than the rounded tile's transparent corners.
    const maskable = fs.readFileSync(MASKABLE_PATH);
    await sharp(maskable)
        .resize(512, 512, { fit: "cover", kernel: "lanczos3" })
        .png()
        .toFile(path.join(PUBLIC_DIR, "icon-maskable-512.png"));
    console.log("  ✓ icon-maskable-512.png");

    // Apple ignores transparency on touch icons, so use the full-bleed art.
    await sharp(maskable)
        .resize(180, 180, { fit: "cover", kernel: "lanczos3" })
        .png()
        .toFile(path.join(PUBLIC_DIR, "apple-touch-icon.png"));
    console.log("  ✓ apple-touch-icon.png (180)");

    // Scalable favicon for modern browsers.
    fs.copyFileSync(SOURCE_PATH, path.join(PUBLIC_DIR, "favicon.svg"));
    console.log("  ✓ favicon.svg");

    // 2. favicon.ico — multi-resolution (16/32/48). Also the fallback target in
    //    BrandingContext when an org has no custom logo.
    const icoBuffers = await Promise.all(
        [16, 32, 48].map((size) => sharp(source).resize(size, size, { fit: "cover" }).png().toBuffer()),
    );
    const ico = await pngToIco(icoBuffers);
    fs.writeFileSync(path.join(PUBLIC_DIR, "favicon.ico"), ico);
    console.log("  ✓ favicon.ico (16/32/48)");

    console.log("\nDone! Client icons regenerated from desktop/icons/icon-source.svg");
}

generate().catch((err) => {
    console.error("Client icon generation failed:", err);
    process.exit(1);
});
