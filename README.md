### squared-functions 0.5

These are some of the available options when creating archives or copying files with squared 2.1.

```javascript
// NOTE: format: zip | tar | gz/tgz | compress: gz | br

squared.settings.outputArchiveFormat = 'tar'; // Default: "zip"

squared.saveAs('archive1', { // OR: archive1.gz
    format: 'gz',
    assets: [
        {
            pathname: 'app/src/main/res/drawable',
            filename: 'ic_launcher_background.xml',
            uri: 'http://localhost:3000/common/images/ic_launcher_background.xml',
            compress: [{ format: 'gz', level: 9 }, { format: 'br' }]
        }
    ],

    // All attributes are optional (case-sensitive except extension)
    exclusions: {
        glob: ['**/*.zip'],
        pathname: ['app/build', 'app/libs'],
        filename: ['ic_launcher_foreground.xml'],
        extension: ['iml', 'pro'],
        pattern: ['output', /grad.+?\./i, '\\.git']
    }
});
```

Image conversion can be achieved using the "commands" array property in a FileAsset object. The supported formats are:

* png - r/w
* jpeg - r/w
* webp - r/w
* bmp - r/w
* gif - r
* tiff - r

NOTE: WebP support requires manual NPM installation of the binaries.

* dwebp - r
* cwebp - w

npm install dwebp-bin && npm install cwebp-bin

```javascript
// All commands are optional except "format". Outer groupings and inner brackets are required.

+ <format>

- @|%
- ( minSize(n,0) , maxSize(n,*) )
- ( width(n|auto) x height(n|auto) [bilinear|bicubic|hermite|bezier]? ^(cover|contain|scale)?[left|center|right|top|middle|bottom]? #background-color? )
- ( left(+|-n) , top(+|-n) | cropWidth(n) x cropHeight(n) )
- { ...rotate(n) #background-color? }
- | opacity(0.0-1.0) OR jpeg_webp_quality(0-100)[photo|picture|drawing|icon|text]?[0-100]?| // cwebp: -preset -near_lossless
- !method // no arguments (e.g. jimp: dither565|greyscale|invert|normalize|opaque|sepia)
```

@ - replace  
% - smaller

Placing an @ symbol (png@) after the format will remove the original file from the package. Using the % symbol (png%) instead will choose the smaller of the two files. You can also use these commands with the setting "convertImages" in the Android framework as a string with the "+" chain format.

```javascript
// NOTE: Multiple transformations per asset use the ':' as the separator when using "data-chrome-file"

webp(50000,*)(800x600[bezier]^contain[right|bottom]#FFFFFF)(-50,50|200x200){45,135,215,315#FFFFFF}|0.5||100[photo][75]|!opaque!greyscale
```

```javascript
const options = {
    assets: [
        {
            pathname: 'images',
            filename: 'pencil.png',
            mimeType: 'image/png',
            commands: ['jpeg'],
            uri: 'http://localhost:3000/common/images/pencil.png'
        },
        {
            pathname: 'images',
            filename: 'pencil.png',
            mimeType: 'image/png',
            commands: ['bmp@(50000,100000)'],
            uri: 'http://localhost:3000/common/images/pencil.png'
        }
    ]
};
```

[TinyPNG](https://tinypng.com/developers) is used for compression and supports only PNG and JPEG.

### Gulp

Tasks can be performed with Gulp to take advantage of their pre-built plugin repository. Gulp is the final stage preceding archiving or copying after file content has been downloaded and transformed.

* [npm install -g gulp-cli && npm install gulp](https://gulpjs.com/docs/en/getting-started/quick-start)

```javascript
// squared.settings.json

{
  "gulp": {
    "minify": "./gulpfile.js"
    "beautify": "./gulpfile.js",
    "compress": "./gulpfile.android.js"
  }
}

// chrome
{
  "selector": "head > script:nth-of-type(1)",
  "type": "js",
  "tasks": [
    "minify",
    "beautify"
  ]
}

// android
const options = {
    assets: [
        {
            pathname: 'images',
            filename: 'pencil.png',
            mimeType: 'image/png',
            tasks: ['compress'],
            uri: 'http://localhost:3000/common/images/pencil.png'
        }
    ]
};
```

```xml
<!-- chrome -->
<script src="/common/system.js" data-chrome-tasks="minify+beautify"></script>

<!-- android -->
<img src="https://s3-us-west-2.amazonaws.com/s.cdpn.io/12005/harbour1.jpg" data-android-tasks="compress" />
```

```javascript
// gulpfile.js

const gulp = require('gulp');
const uglify = require('gulp-uglify');
 
gulp.task('minify', () => {
  return gulp.src('*')
    .pipe(uglify())
    .pipe(gulp.dest('./'));
});

// NOTE: SRC (temp) and DEST (original) always read and write to the current directory
```

Renaming files with Gulp is not recommended. It is better to use the "saveAs" or "filename" attributes when the asset is part of the HTML page.

### CHROME: Saving web page assets

Bundling options are available with these HTML tag names.

* saveAs: html + script + link
* exportAs: script + style
* exclude: script + link + style

Files with the same path and filename will automatically create a bundle assuming there are no conflicts in call ordering.

```javascript
{
  "selector": "head > script:nth-of-type(2), head > script:nth-of-type(3)",
  "type": "js",
  "saveAs": "js/modules2.js"
}
```

JS and CSS files can be bundled together with the "saveAs" or "exportAs" action. Multiple transformations per asset can be chained using the "+" symbol. Whitespace can be used between anything for readability.

```xml
Separator : ::

Same (1-2): ~
Chain  (2): +
Option (3): |
```

```xml
* preserve - Prevent unused styles from being deleted (css)
* inline - Content is extracted and rendered inline with <script> or <style> (js/css)
* compress
    - png TinyPNG service for PNG or JPEG
    - gz  Gzip
    - br  Brotli
* base64 - Content is rendered inline with base64 encoding (image)
```

```xml
<link data-chrome-file="saveAs:css/prod.css::beautify::preserve|inline" rel="stylesheet" href="css/dev.css" />
<style data-chrome-file="exportAs:css/prod.css::minify+beautify::compress[gz]">
    body {
        font: 1em/1.4 Helvetica, Arial, sans-serif;
        background-color: #fafafa;
    }
</style>
<script data-chrome-file="saveAs:js/bundle1.js::minify" src="/dist/squared.js"></script>
<script data-chrome-file="saveAs:js/bundle1.js::minify" src="/dist/squared.base.js"></script>
<script data-chrome-file="saveAs:js/bundle2.js" src="/dist/chrome.framework.js"></script>
```

Bundling with inline commands using a 1-2-1 format may cause the generated bundle to execute incorrectly. Other configuration methods will create a new file when it finds any conflicts. The advantages of bundling this way gives you the ability to debug source code inside &lt;script&gt; elements.

### Raw assets: saveTo command

You can use images commands with saveTo (directory) on any element when the image is the primary display output. Encoding with base64 is also available using the "::base64" commmand as the third argument. Transformations are given arbitrary filenames and the original file is preserved.

```xml
<!-- NOTE: img | video | audio | source | track | object | embed | iframe -->

<img src="https://s3-us-west-2.amazonaws.com/s.cdpn.io/12005/harbour1.jpg"
     data-chrome-file="saveTo: ../images/harbour :: png(10000,75000)(800x600[bezier]^contain[right|bottom]) :: compress|base64" />

<!-- "saveTo:~::~::base64" -->
```

### Built-In plugins

JS and CSS files can be optimized further using these settings:

* beautify
* minify
* es5 (Babel)
* es5-minify (UglifyJS)
* custom name

You can also define your own optimizations in squared.settings.json:

* [npm i @babel/core && npm i @babel/preset-env](https://github.com/babel/babel)
* [npm i rollup](https://github.com/rollup/rollup)
* [npm i terser](https://github.com/terser/terser)
* [npm i uglify-js](https://github.com/mishoo/UglifyJS)
* [npm i postcss](https://github.com/postcss/postcss)
* [npm i prettier](https://github.com/prettier/prettier)
* [npm i clean-css](https://github.com/jakubpawlowicz/clean-css)
* [npm i posthtml](https://github.com/postcss/postcss)
* [npm i html-minifier-terser](https://github.com/DanielRuf/html-minifier-terser)
* [npm i html-minifier](https://github.com/kangax/html-minifier)

These particular plugins can be configured using a plain object literal. Manual installation is required when using any of these packages [<b>npm run install-chrome</b>]. Transpiling with Babel is also configurable with a .babelrc file in the base folder for any presets and additional settings. Other non-builtin minifiers can similarly be applied and chained by defining a custom string-based synchronous function.

```xml
chrome -> html | js | css -> npm package name -> custom name
```

* Function object
* file relative to serve.js
* function closure

```javascript
// squared.settings.json

{
  "chrome": {
    "html": { // built-in minifier
      "posthtml": {
        "transform": {
          "plugins": [
            ["posthtml-doctype", { "doctype": "HTML 5" }], // Plugins have be installed with NPM manually
            ["posthtml-include", { "root": "./", "encoding": "utf-8" }]
          ]
        },
        "transform-output": {
          "directives": [
            { "name": "?php", "start": "<", "end": ">" }
          ]
        }
      },
      "prettier": {
        "beautify": {
          "parser": "html",
          "printWidth": 120,
          "tabWidth": 4
        }
      }
    },
    "js": { // custom function (chrome -> eval_function: true)
      "terser": {
        "minify-example": "function(context, value, output) { return context.minify(value, output).code; }", // "minify-example-output" creates scoped variable "output"
        "minify-example-output": {
          "keep_classnames": true
        }
      },
      "@babel/core": {
        "es5-example": "./es5.js" // startsWith('./ | ../')
      },
      "rollup": {
        "bundle-es6": {
          "plugins": [
            ["@rollup/plugin-json", { compact: true }]
          ],
          "external": ["lodash"]
        },
        "bundle-es6-output": "./rollup.output.config.json" // supplemental JSON configuration settings use the "-output" suffix
      }
    },
    "css": {
      "postcss": {
        "transform": {
          "plugins": ["autoprefixer", "cssnano"] // Plugins have be installed with NPM manually
        }
      },
      "node-sass": { // npm i node-sass
        "sass-example": "function(context, value) { return context.renderSync({ data: value }, functions: {}); }" // first transpiler in chain
      }
    }
  }
}
```

```javascript
// es5.js

function (context, value, output /* optional: "@babel/core-output" */) {
    const options = { presets: ['@babel/preset-env'] }; // <https://babeljs.io/docs/en/options>
    return context.transformSync(value, output).code;
}
```

The same concept can be used inline anywhere using a &lt;script&gt; tag with the type attribute set to "text/template". The script template will be completely removed from the final output.

```javascript
// "es5-example" is a custom name (chrome -> eval_text_template: true)

<script type="text/template" data-chrome-template="js::@babel/core::es5-example">
function (context, value, output /* optional */, input /* optional */) {
    const options = { ...output, presets: ['@babel/preset-env'], sourceMaps: true };
    const result = context.transformSync(value, options);
    if (result) {
        if (result.map) {
            input.nextMap('babel', result.map, result.code);
        }
        return result.code;
    }
}
</script>
```

Here is the equivalent YAML settings and when available has higher precedence than JSON settings.

- [squared.settings.json](https://github.com/anpham6/squared-functions/blob/master/examples/squared.settings.json)
- [squared.settings.yml](https://github.com/anpham6/squared-functions/blob/master/examples/squared.settings.yml)

### Modifying content attributes

There are possible scenarios when a transformation may cause an asset type to change into another format.

```xml
<!-- before -->
<link id="sass-example" rel="alternate" type="text/plain" href="css/dev.sass" />
```

```javascript
{
  "selector": null,
  "type": "css",
  "filename": "prod.css",
  "attributes": [
    {
      "name": "id"
    },
    {
      "name": "rel",
      "value": "stylesheet"
    },
    {
      "name": "type",
      "value": "text/css"
    },
    {
      "name": "title",
      "value": ""
    },
    {
      "name": "disabled",
      "value": null
    }
  ],
  "process": [
    "node-sass"
  ]
}
```

```xml
<!-- after -->
<link rel="stylesheet" type="text/css" title="" disabled href="css/prod.css" />
```

### External configuration

JSON (json/js) configuration is optional and is provided for those who prefer to separate the bundling and transformations from the HTML. Any assets inside the configuration file will override any settings either inline or from JavaScript. You can also use the equivalent in YAML (yml/yaml) for configuring as well.

```javascript
interface FileModifiers {
    preserve?: boolean; // type: css
    inline?: boolean; // type: js | css
    base64?: boolean; // type: image
    compress?: { format: string, level?: number }[];
}

interface OutputModifiers {
    tasks?: string[];
    watch?: boolean | { interval?: number | expires?: string }; // type: js | css | image (expires: 1h 1m 1s)
    attributes?: { name: string, value?: string }[];
    cloudStorage?: CloudService[];
    ignore?: boolean;
    exclude?: boolean;
}

interface AssetCommand extends FileModifiers, OutputModifiers {
    selector?: string;
    type?: string;
    saveAs?: string; // type: js | css
    exportAs?: string; // type: js | css
    saveTo?: string; // type: image | video | audio (transforms create multiple files and are given a UUID filename)
    pathname?: string; // alias for "saveTo"
    filename?: string; // type: html | ...image
    process?: string[]; // type: js | css
    commands?: string[]; // type: image
    template?: {
        module?: string;
        identifier?: string;
        value?: string;
    };
}
```

- [bundle.yml](https://github.com/anpham6/squared/blob/master/html/chrome/bundle.yml)
- [bundle.json](https://github.com/anpham6/squared/blob/master/html/chrome/bundle.json)

```javascript
squared.saveAs('bundle.zip', { configUri: 'http://localhost:3000/chrome/bundle.yml' });
```

Here is the equivalent page using only inline commands with "data-chrome-file" and "data-chrome-tasks".

- [bundle_inline.html](https://github.com/anpham6/squared/blob/master/html/chrome/bundle_inline.html)

### Cloud storage

Manual installation of the SDK is required including opening an account with at least one of these cloud storage provider.

```xml
* Amazon AWS
  - npm install aws-sdk
  - S3: https://aws.amazon.com/free (5GB)

* Microsoft
  - npm install @azure/storage-blob
  - Azure: https://azure.microsoft.com/en-us/free (5GB)

* Google
  - npm install @google-cloud/storage
  - GCS: https://cloud.google.com/free (5GB)

* Oracle
  - npm install aws-sdk (uses S3 compatibility API)
  - OCI: https://www.oracle.com/cloud/free/ (10GB)
```

Other service providers can be integrated similarly except for credential verification.

```javascript
// NOTE: Optional fields are supported by all services

{
  "selector": "#picture1",
  "type": "image",
  "commands": [
    "png(100x200){90,180,270}" // Uploaded with UUID filename
  ],
  "cloudStorage": [
    {
      "service": "s3",
      "bucket": "squared-001",
      "accessKeyId": "**********", // Using settings (optional)
      "secretAccessKey": "**********", // Using settings (optional)
      "active": true, // Rewrites "src" to cloud storage location (optional)
      "localStorage": false, // Removes all files from archive or local disk (optional)
      "uploadAll": true, // Include transforms (optional)
      "filename": "picture1.webp" // Choose a different bucket filename (optional)
      "overwrite": false // Always use current filename (optional)
    },
    {
      "service": "azure",
      "container": "squared-002",
      "accountName": "**********",
      "accountKey": "**********",
      "apiEndpoint": "http://squaredjs.azureedge.net/squared-002" // e.g. CDN (optional)
    },
    {
      "service": "gcs",
      "bucket": "squared-003", // Can be generated automatically (optional)
      "publicAccess": false, // Only applies when a bucket is created (optional: "true" when active is "true")
      "keyFilename": "./gcs.json", // Path to JSON credentials
      "settings": "main" // Load host configuration at instantiation (optional)
    },
    {
      "service": "oci",
      "bucket": "squared-004", // System defined buckets are private
      "region": "us-phoenix-1", // Using settings (optional)
      "namespace": "abcdefghijkl", // Using settings (optional)
      "accessKeyId": "**********", // Using settings (optional)
      "secretAccessKey": "**********", // Using settings (optional)
      "settings": "main"
    }
  ]
}
```

Serving CSS files from cloud storage or CDN requires every image inside the file to be hosted with an absolute URL.

```javascript
squared.saveAs('index.zip', {
    configUri: 'http://localhost:3000/chrome/bundle.yml',
    saveAs: {
        image: { // Non-element images using url() method
            cloudStorage: [{
                service: 's3',
                bucket: 'squared-001',
                active: true,
                settings: 'main'
            }]
        }
    }
});
```

Inline commands are not supported when using cloud storage.

### Options: Development / Production

The entire page can similarly be transformed as a group using the "saveAs" attribute in options. Cloud storage can be used for all assets except HTML using the same configuration as element selectors.

```javascript
squared.saveAs('index.zip', {
    removeUnusedStyles: false, // Use only when you are not switching classnames with JavaScript
    productionRelease: false, // Ignore local url rewriting and load assets using absolute paths
    preserveCrossOrigin: false, // Ignore downloading a local copy of assets hosted on other domains

    // All attributes are optional except "filename" for <script> and <link>.
    saveAs: {
        html: { filename: 'index.html', format: 'beautify', attributes: [{ name: 'lang', value: 'en' }] },
        script: { pathname: '../js', filename: 'bundle.js', format: 'es5+es5-minify' },
        link: { pathname: 'css', filename: 'bundle.css', preserve: true, inline: true },
        image: { base64: true },
        base64: { format: 'png' }
    }
}); 
```

Setting the active cloud storage filename to a JS/CSS bundle might not have any effect since it is possible more than one bundle will be created.

```javascript
// NOTE: js | css | image | video | audio

{
  "selector": "script",
  "type": "js",
  "watch": {
    "interval": 100,
    "expires": "1h 1m 1s"
  },
  "process": [
    "bundle",
    "minify"
  ],
  "cloudStorage": [
    {
      "service": "s3",
      "bucket": "squared-001",
      "active": true,
      "settings": 'main'
    }
  ]
}

squared.copyTo('/local/user/www', {
    watch: true,
    saveAs: {
        script: { pathname: '../js', format: 'es5+es5-minify', watch: true },
        link: { pathname: 'css', filename: 'bundle.css', watch: { interval: 500 } }
    }
});
```

```xml
<!-- chrome -->
<script src="/common/system.js" data-chrome-watch="true"></script>

<!-- android -->
<img src="images/harbour1.jpg" data-android-watch="1000::1h 30m" />
```

File watching is available and uses HTTP HEAD requests to determine modifications. You can also watch any file that is served using HTTP on a different server or computer. The HTML page or any assets inlined cannot be watched since changes to the DOM structure requires a complete browser reload.

### Asset exclusion

You can exclude unnecessary processing files using the dataset attribute in &lt;script|link|style&gt; tags.

```xml
<script data-chrome-file="exclude" src="/dist/squared.js"></script>
<script data-chrome-file="exclude" src="/dist/squared.base.js"></script>
<script data-chrome-file="exclude" src="/dist/chrome.framework.js"></script>
<script data-chrome-file="exclude">
    squared.setFramework(chrome);
    squared.save();
</script>
```

You can similarly prevent an asset from being downloaded or transformed using the "ignore" command.

```xml
<iframe src="https://www.google.com/maps" data-chrome-file="ignore" />
```

### LICENSE

MIT