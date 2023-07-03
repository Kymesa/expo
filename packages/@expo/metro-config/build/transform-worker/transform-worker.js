"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformCss = exports.matchSvgModule = exports.transformSvg = exports.transform = void 0;
const metro_transform_worker_1 = __importDefault(require("metro-transform-worker"));
const path_1 = __importDefault(require("path"));
const css_1 = require("./css");
const css_modules_1 = require("./css-modules");
const postcss_1 = require("./postcss");
const sass_1 = require("./sass");
const countLines = require('metro/src/lib/countLines');
async function transform(config, projectRoot, filename, data, options) {
    // SVG Modules must be first
    if (process.env._EXPO_METRO_SVG_MODULES) {
        if (matchSvgModule(filename)) {
            return transformSvg(config, projectRoot, filename, data, {
                ...options,
                // SVG Modules are still processed as assets, but we need to transform them as modules.
                type: 'module',
            });
        }
    }
    if (options.type === 'asset') {
        return metro_transform_worker_1.default.transform(config, projectRoot, filename, data, options);
    }
    if (process.env._EXPO_METRO_CSS_MODULES) {
        if (/\.(s?css|sass)$/.test(filename)) {
            return transformCss(config, projectRoot, filename, data, options);
        }
    }
    const environment = options.customTransformOptions?.environment;
    if (environment === 'client' &&
        // TODO: Ensure this works with windows.
        // TODO: Add +api files.
        filename.match(new RegExp(`^app/\\+html(\\.${options.platform})?\\.([tj]sx?|[cm]js)?$`))) {
        // Remove the server-only +html file from the bundle when bundling for a client environment.
        return metro_transform_worker_1.default.transform(config, projectRoot, filename, !options.minify
            ? Buffer.from(
            // Use a string so this notice is visible in the bundle if the user is
            // looking for it.
            '"> The server-only +html file was removed from the client JS bundle by Expo CLI."')
            : Buffer.from(''), options);
    }
    return metro_transform_worker_1.default.transform(config, projectRoot, filename, data, options);
}
exports.transform = transform;
async function transformSvg(config, projectRoot, filename, data, options) {
    const { resolveConfig, transform } = require('@svgr/core');
    const isNotNative = !options.platform || options.platform === 'web';
    const defaultSVGRConfig = {
        native: !isNotNative,
        plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx'],
        svgoConfig: {
            // TODO: Maybe there's a better config for web?
            plugins: [
                {
                    name: 'preset-default',
                    params: {
                        overrides: {
                            inlineStyles: {
                                onlyMatchedOnce: false,
                            },
                            removeViewBox: false,
                            removeUnknownsAndDefaults: false,
                            convertColors: false,
                        },
                    },
                },
            ],
        },
    };
    const svgUserConfig = await resolveConfig(path_1.default.dirname(filename));
    const svgrConfig = svgUserConfig ? { ...defaultSVGRConfig, ...svgUserConfig } : defaultSVGRConfig;
    return metro_transform_worker_1.default.transform(config, projectRoot, filename, Buffer.from(await transform(data.toString(), svgrConfig)), options);
}
exports.transformSvg = transformSvg;
function matchSvgModule(filePath) {
    return !!/\.module(\.(native|ios|android|web))?\.svg$/.test(filePath);
}
exports.matchSvgModule = matchSvgModule;
async function transformCss(config, projectRoot, filename, data, options) {
    // If the platform is not web, then return an empty module.
    if (options.platform !== 'web') {
        const code = (0, css_modules_1.matchCssModule)(filename) ? 'module.exports={ unstable_styles: {} };' : '';
        return metro_transform_worker_1.default.transform(config, projectRoot, filename, 
        // TODO: Native CSS Modules
        Buffer.from(code), options);
    }
    let code = data.toString('utf8');
    // Apply postcss transforms
    code = await (0, postcss_1.transformPostCssModule)(projectRoot, {
        src: code,
        filename,
    });
    // TODO: When native has CSS support, this will need to move higher up.
    const syntax = (0, sass_1.matchSass)(filename);
    if (syntax) {
        code = (0, sass_1.compileSass)(projectRoot, { filename, src: code }, { syntax }).src;
    }
    // If the file is a CSS Module, then transform it to a JS module
    // in development and a static CSS file in production.
    if ((0, css_modules_1.matchCssModule)(filename)) {
        const results = await (0, css_modules_1.transformCssModuleWeb)({
            filename,
            src: code,
            options: {
                projectRoot,
                dev: options.dev,
                minify: options.minify,
                sourceMap: false,
            },
        });
        const jsModuleResults = await metro_transform_worker_1.default.transform(config, projectRoot, filename, Buffer.from(results.output), options);
        const cssCode = results.css.toString();
        const output = [
            {
                type: 'js/module',
                data: {
                    // @ts-expect-error
                    ...jsModuleResults.output[0]?.data,
                    // Append additional css metadata for static extraction.
                    css: {
                        code: cssCode,
                        lineCount: countLines(cssCode),
                        map: [],
                        functionMap: null,
                    },
                },
            },
        ];
        return {
            dependencies: jsModuleResults.dependencies,
            output,
        };
    }
    // Global CSS:
    const { transform } = await Promise.resolve().then(() => __importStar(require('lightningcss')));
    // TODO: Add bundling to resolve imports
    // https://lightningcss.dev/bundling.html#bundling-order
    const cssResults = transform({
        filename,
        code: Buffer.from(code),
        sourceMap: false,
        cssModules: false,
        projectRoot,
        minify: options.minify,
    });
    // TODO: Warnings:
    // cssResults.warnings.forEach((warning) => {
    // });
    // Create a mock JS module that exports an empty object,
    // this ensures Metro dependency graph is correct.
    const jsModuleResults = await metro_transform_worker_1.default.transform(config, projectRoot, filename, options.dev ? Buffer.from((0, css_1.wrapDevelopmentCSS)({ src: code, filename })) : Buffer.from(''), options);
    const cssCode = cssResults.code.toString();
    // In production, we export the CSS as a string and use a special type to prevent
    // it from being included in the JS bundle. We'll extract the CSS like an asset later
    // and append it to the HTML bundle.
    const output = [
        {
            type: 'js/module',
            data: {
                // @ts-expect-error
                ...jsModuleResults.output[0]?.data,
                // Append additional css metadata for static extraction.
                css: {
                    code: cssCode,
                    lineCount: countLines(cssCode),
                    map: [],
                    functionMap: null,
                },
            },
        },
    ];
    return {
        dependencies: jsModuleResults.dependencies,
        output,
    };
}
exports.transformCss = transformCss;
/**
 * A custom Metro transformer that adds support for processing Expo-specific bundler features.
 * - Global CSS files on web.
 * - CSS Modules on web.
 * - TODO: Tailwind CSS on web.
 */
module.exports = {
    // Use defaults for everything that's not custom.
    ...metro_transform_worker_1.default,
    transform,
};
