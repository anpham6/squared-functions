## squared-functions 0.14

These are the available options when creating archives or copying files. Examples use squared 2.4 although the concepts can be used similarly with any NodeJS application and has no features that require using Express.

### Image

Image conversion can be achieved using the "commands" array property in a FileAsset object. The supported formats are:

```javascript
* png - r/w
* jpeg - r/w
* webp - r/w
* bmp - r/w
* gif - r
* tiff - r

// NOTE: WebP support requires manual NPM installation of the binaries.

* dwebp - r // npm i dwebp-bin
* cwebp - w // npm i cwebp-bin
```

```javascript
// All commands are optional except "format". Outer groupings and inner brackets are required.

+ <format>

- @|%
- ~size(n)(w|x) // chrome only
- ( minSize(n,0) , maxSize(n,*) )
- ( width(n|auto) x height(n|auto) [bilinear|bicubic|hermite|bezier]? ^(cover|contain|scale)?[left|center|right|top|middle|bottom]? #background-color? )
- ( left(+|-n) , top(+|-n) | cropWidth(n) x cropHeight(n) )
- { ...rotate(n) #background-color? }
- | opacity(0.0-1.0) OR jpeg_webp_quality(0-100)[photo|picture|drawing|icon|text]?[0-100]?| // cwebp: -preset -near_lossless
- !method // no arguments (e.g. jimp: dither565|greyscale|invert|normalize|opaque|sepia)
```

@ - replace  
% - smaller

Placing an @ symbol (png@) after the format will remove the original file from the package. Using the % symbol (png%) instead will choose the smaller of the two files. You can also use these commands with the setting "convertImages" in the Android framework.

```javascript
// data-chrome-commands: Multiple transformations use the "::" as the separator

webp(50000,*)(800x600[bezier]^contain[right|bottom]#FFFFFF)(-50,50|200x200){45,135,215,315#FFFFFF}|0.5||100[photo][75]|!opaque!greyscale

webp~800w(800x600) // chrome srcset attribute
webp~2x(1024x768)
```

[Tinify](https://tinypng.com/developers) is used for image compression and supports PNG and JPEG. The first 500 images are free each month with a developer API key.

```javascript
// squared.settings.json
{
  "compress": {
    "tinify_api_key": "**********" // default api key
  }
}

// HTML configuration (json/yaml/toml)
{
  "selector": ".card:nth-of-type(1) img",
  "type": "image",
  "compress": [
    {
      "format": "png", // OR: jpeg
      "plugin": "tinify", // optional (pre-installed)
      "options": {
        "apiKey": "**********" // optional (overrides settings)
      }
    }
  ]
}
```

Other formats can be compressed similarly using imagemin. Manual installation is required (plugin only) and can be configured using the options attribute.

```javascript
{
  "selector": ".card:nth-of-type(1) img",
  "type": "image",
  "compress": [
    {
      "format": "png",
      "plugin": "imagemin-pngquant", // npm i imagemin-pngquant
      "options": {
        "quality": [
          0.6,
          0.8
        ]
      }
    }
  ]
}
```

### Tasks

Tasks can be performed preceding archiving or copying after file content has been downloaded and also transformed.

* Gulp: [npm i -g gulp-cli && npm i gulp](https://gulpjs.com/docs/en/getting-started/quick-start)

```javascript
// squared.settings.json

{
  "task": {
    "gulp": {
      "handler": "@squared-functions/task/gulp",
      "settings": {
        "minify": "./gulpfile.js"
        "beautify": "./gulpfile.js",
        "compress": "./gulpfile.android.js"
      }
    }
  }
}

// chrome
{
  "selector": "head > script:nth-of-type(1)",
  "type": "js",
  "tasks": [
    { handler: "gulp", task: "minify" },
    { handler: "gulp", task: "beautify", preceding: "true" } // execute tasks before transformations
  ]
}

// android
squared.saveAs("index.zip", {
    assets: [{
        pathname: "images",
        filename: "pencil.png",
        mimeType: "image/png",
        commands: ["jpeg", "bmp@(50000,100000)"],
        tasks: [{ handler: "gulp", task: "compress" }],
        uri: "http://localhost:3000/common/images/pencil.png"
    }]
});
```

```xml
<!-- chrome -->
<script src="/common/util.js" data-chrome-tasks="gulp:minify+gulp:beautify:true"></script>

<!-- android -->
<img src="https://s3-us-west-2.amazonaws.com/s.cdpn.io/12005/harbour1.jpg" data-android-tasks="gulp:compress">
```

NOTE: SRC (temp) and DEST (original) always read and write to the current directory.

```javascript
// gulpfile.js

const gulp = require("gulp");
const uglify = require("gulp-uglify");
 
gulp.task("minify", () => {
  return gulp.src("*")
    .pipe(uglify())
    .pipe(gulp.dest("./"));
});
```

Renaming files with Gulp is not recommended with Chrome. It is better to use the "saveAs" or "filename" attributes when the asset is part of the HTML page.

### Document: CHROME

Bundling options are available with these HTML tag names.

* saveAs: html + script + link
* exportAs: script + style
* exclude: script + link + style

Files with the same path and filename will automatically create a bundle assuming there are no conflicts in call ordering.

```javascript
// HTML configuration (json/yaml/toml) is recommended

{
  "selector": "head > script:nth-of-type(2), head > script:nth-of-type(3)",
  "type": "js",
  "saveAs": "js/modules2.js"
}
```

JS and CSS files can be bundled together with the "saveAs" or "exportAs" action. Multiple transformations per bundle can be chained using the "+" symbol.

```javascript

+ saveAs: location | ~  // same
+ exportAs: location

- ::
- format (chain "+")
```

These are the available option modifiers:

```xml
* preserve
    - css: Prevent unused styles from being deleted
* inline
    - js: Rendered inline with <script>
    - css: Rendered inline with <style>
    - image: Rendered as base64 from file
* blob
    - image: Rendered as file from base64
* compress
    - png: TinyPNG service for PNG or JPEG
    - gz: Gzip
    - br: Brotli
* crossorigin
    - all: Same as preserveCrossOrigin [download: false]
```

NOTE: Whitespace can be used between anything for readability.

```xml
<link rel="stylesheet" href="css/dev.css" data-chrome-file="saveAs:css/prod.css::beautify" data-chrome-options="preserve|inline">
<style data-chrome-file="exportAs:css/prod.css::minify+beautify" data-chrome-options="compress[gz]">
    body {
        font: 1em/1.4 Helvetica, Arial, sans-serif;
        background-color: #fafafa;
    }
</style>
<script src="/dist/squared.js" data-chrome-file="saveAs:js/bundle1.js::minify"></script>
<script src="/dist/squared.base.js" data-chrome-file="saveAs:js/bundle1.js::minify"></script>
<script src="/dist/chrome.framework.js" data-chrome-file="saveAs:js/bundle2.js"></script>
```

Bundling with "exportAs" gives you the ability to debug source code inside &lt;script&gt; elements.

#### Raw assets

```xml
<!-- img | video | audio | source | track | object | embed | iframe -->

<img src="https://s3-us-west-2.amazonaws.com/s.cdpn.io/12005/harbour1.jpg"
     data-chrome-file="saveAs:images/harbour.jpg"
     data-chrome-options="compress">
```

You can use images commands with saveTo (directory) on any element where the image is the primary display output.

```xml
<!-- img | object | embed | iframe -->

<img src="https://s3-us-west-2.amazonaws.com/s.cdpn.io/12005/harbour1.jpg"
     data-chrome-file="saveTo:../images/harbour"
     data-chrome-commands="png(10000,75000)(800x600[bezier]^contain[right|bottom])"
     data-chrome-options="compress|inline">
```

Transformations including the original file are given a UUID filename. Leaving "file" empty will save the transformations to the current image directory.

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

These particular plugins can be configured using a plain object literal. Manual installation is required when using any of these packages [<b>npm run install-chrome</b>]. Other non-builtin minifiers can similarly be applied and chained by defining a custom string-based function.

Custom plugins can also be installed from NPM. The function has to be named "transform" for validation purposes and can be asynchronous. The only difference is the context object is set to the Document module. Examples can be found in the "chrome/packages" folder.

* Function object
* file relative to serve.js
* function closure

```javascript
// squared.settings.json: chrome -> html | js | css -> npm package name -> process name

{
  "document": {
    "chrome": {
      "handler": "@squared-functions/document/chrome",
      "eval_function": true,
      "eval_template": false,
      "settings": {
        "transform": {
          "html": { // built-in minifier
            "posthtml": {
              "transform": {
                "plugins": [
                  ["posthtml-doctype", { "doctype": "HTML 5" }], // Plugins have to be installed with NPM manually
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
              "minify-example": "async function (context, value, options) { return await context.minify(value, options.outputConfig).code; }", // "minify-example-output" creates variable "options.outputConfig"
              "minify-example-output": {
                "keep_classnames": true
              }
            },
            "@babel/core": {
              "es5-example": "./es5.js" // startsWith("./ | ../")
            },
            "rollup": {
              "bundle-es6": {
                "plugins": [
                  ["@rollup/plugin-json", { compact: true }]
                ],
                "external": ["lodash"]
              },
              "bundle-es6-output": "./rollup.output.config.json" // supplemental JSON configuration settings use the "-output" suffix
            },
            "npm-custom-plugin": {
              "custom-example": {
                "sourceMap": true
              }
            }
          },
          "css": {
            "postcss": {
              "transform": {
                "plugins": ["autoprefixer", "cssnano"] // Plugins have to be installed with NPM manually
              }
            },
            "sass": { // npm i sass
              "sass-example": "function (context, value, options, resolve) { resolve(context.renderSync({ ...options.outputConfig, data: value }, functions: {}).css); }" // Synchronous with Promise
            }
          }
        }
      }
    }
  }
}
```

Custom asynchronous functions in settings is supported as of @squared-functions 0.14 (squared 2.5).

```javascript
// es5.js

interface TransformOutput {
    file?: ExternalAsset;
    sourceFile?: string;
    sourcesRelativeTo?: string;
    sourceMap?: SourceMapInput;
    external?: PlainObject;
}

interface TransformOptions extends TransformOutput {
    baseConfig: StandardMap;
    outputConfig: StandardMap; // Same as baseConfig when using an inline transformer
    sourceMap: SourceMapInput;
    writeFail: ModuleWriteFailMethod;
}

// Example using Promise "resolve" callbacks

function (context, value, options, resolve) {
    context.transform(value, options.outputConfig, function(err, result) {
        resolve(!err && result ? result.code : "");
    });
}
```

The same concept can be used inline anywhere using a &lt;script&gt; tag with the type attribute set to "text/template". The script template will be completely removed from the final output.

```javascript
// "es5-example" is a custom name (chrome -> eval_template: true)

<script type="text/template" data-chrome-template="js::@babel/core::es5-example">
async function (context, value, options) {
    const options = { ...options.outputConfig, presets: ["@babel/preset-env"], sourceMaps: true }; // <https://babeljs.io/docs/en/options>
    const result = await context.transform(value, options);
    if (result) {
        if (result.map) {
            options.sourceMap.nextMap("babel", result.code, result.map);
        }
        return result.code;
    }
}
</script>
```

Transpiling with Babel is also configurable with a .babelrc file in the base folder.

Here is the equivalent configuration in YAML and when available has higher precedence than JSON.

- [squared.settings.json](https://github.com/anpham6/squared-functions/blob/master/examples/squared.settings.json)
- [squared.settings.yml](https://github.com/anpham6/squared-functions/blob/master/examples/squared.settings.yml)

### External configuration

JSON (json/js) configuration is optional and is provided for those who prefer to separate the bundling and transformations from the HTML. Any assets inside the configuration file will override any settings either inline or from JavaScript. You can also use the equivalent in YAML (yml/yaml) for configuring as well.

```javascript
interface OutputModifiers {
    inline?: boolean; // type: js | css | base64: image | font
    blob?: boolean; // type: image | font (base64)
    preserve?: boolean; // type: css | cross-origin: append/js | append/css
    ignore?: boolean;
    exclude?: boolean // type: js | css (remove from HTML)
}

interface AssetCommand extends OutputModifiers {
    selector: string;

    type: "js" | "css" | "image" | "append/js" | "append/css" | "append/[tagName]"
    saveAs?: string; // type: js | css
    exportAs?: string; // type: js | css
    saveTo?: string; // type: image | video | audio (transforms create multiple files and are given a UUID filename)
    pathname?: string; // alias for "saveTo"
    filename?: string; // type: html | ...image
    process?: string[]; // type: js | css
    commands?: string[]; // type: image
    download?: boolean; // Same as preserveCrossOrigin (default is "true")
    cloudStorage?: CloudService[];
    tasks?: string[];
    watch?: boolean | { interval?: number, expires?: string }; // type: js | css | image (expires: 1h 1m 1s)
    attributes?: ObjectMap<Optional<string>>;
    template?: {
        module: string;
        identifier?: string;
        value?: string;
    };

    type: "text" | "attribute" | "display" // database
    dataSource?: {
        source: "uri";
        format: string; // json | yaml | toml
        uri: string;
    };
    dataSource?: CloudDatabase; // source: "cloud"
    dataSource?: {
        source: "mongodb";
        // Same as CloudDatabase
    };

    type: "replace";
    textContent: string; // Replace element.innerHTML

    document?: string | string[]; // Usually "chrome" (optional)
}
```

Only one command per element is supported (except data sources) with the latter selectors taking precedence when there are conflicts. You can use a task if there are additional commands to perform.

- [JSON](https://github.com/anpham6/squared/blob/master/html/chrome/bundle.json)
- [YAML](https://github.com/anpham6/squared/blob/master/html/chrome/bundle.yml)
- [TOML](https://github.com/anpham6/squared/blob/master/html/chrome/bundle.toml)

```javascript
squared.saveAs("bundle.zip", { configUri: "http://localhost:3000/chrome/bundle.yml" });
```

Here is the equivalent page using only inline commands with "data-chrome-file" and "data-chrome-tasks".

- [bundle_inline.html](https://github.com/anpham6/squared/blob/master/html/chrome/bundle_inline.html)

### Modifying content attributes

There are possible scenarios when a transformation may cause an asset type to change into another format.

```xml
<!-- before -->
<link id="sass-example" rel="alternate" type="text/plain" href="css/dev.sass"> <!-- Better to not use " />" self closing tag -->
```

```javascript
// Inline commands are not supported

{
  "selector": "#sass-example",
  "type": "css",
  "filename": "prod.css", // UUID filename: __assign__.css
  "attributes": {
    "id": undefined,
    "rel": "stylesheet",
    "type": "text/css",
    "title": "",
    "disabled": null
  },
  "process": [
    "node-sass"
  ]
}
```

Similar to JSON it is better to use double quotes (or &amp;quot;) and do not use unnecessary spaces around the opening and closing tags. It is also recommended to lower case every element tag name and attribute since the browser does this anyway when parsing your HTML document. Tags that are not well-formed may fail to be replaced.

```xml
<!-- after -->
<link rel="stylesheet" type="text/css" title="" disabled href="css/prod.css">
```

You can also use the workspace feature in [squared-express](https://github.com/anpham6/squared-express#readme) to precompile text assets and using that to build the production release in one routine.

### Appending external JS/CSS

You can append or prepend a sibling element (not child) that can be processed similar to a typical "script" or "link" element. Scripts which insert custom elements during page load should be appended separately when building in order to maintain the original DOM structure.

You can also try using the "useOriginalHtmlPage" request property which sometimes requires the HTML to be well-formed (lowercase tagName and attributes) for successful edits. The only difference is it might not be a live representation of what you see in the browser.

```xml
<html>
<head>
    <title></title>
    <!-- Google Analytics -->
    <script>
    window.ga=window.ga||function(){(ga.q=ga.q||[]).push(arguments)};ga.l=+new Date;
    ga('create', 'UA-XXXXX-Y', 'auto');
    ga('send', 'pageview');
    </script>
    <script async src='https://www.google-analytics.com/analytics.js'></script>
    <!-- End Google Analytics -->
</head>
<body>
</body>
</html>
```

Appends will fail if you remove the sibling selector element from the document.

```javascript
// All commands including prepend are supported in relation to the base type

[
  {
    "selector": "title",
    "type": "append/script", // all tags supported except "html"
    "textContent": "\\nwindow.ga=window.ga||function(){(ga.q=ga.q||[]).push(arguments)};ga.l=+new Date;\\nga('create', 'UA-XXXXX-Y', 'auto');\\nga('send', 'pageview');\\n" // YAML "|" operator preserves indentation (optional)
  },
  {
    "selector": "title",
    "type": "append/js", // prepend/css
    "download": false, // Explicit "false"
    "attributes": {
      "src": "https://www.google-analytics.com/analytics.js", // css: href (required)
      "async": null
    }
  }
]
```

If you are having replacement errors (useOriginalHtmlPage=true) then adding an id will usually be able to locate the element (data-chrome-id="111-111-111").

NOTE: As of squared 2.4 the current state of the DOM (useOriginalHtmlPage=false) is sent to the server which including any updates made with JavaScript (removeInlineStyles).

### Cloud storage

Manual installation of the SDK is required including an account with at least one of these cloud storage provider.

```xml
* Amazon
  - npm i aws-sdk
  - AWS: https://aws.amazon.com/free (5GB - 12 months)

* Microsoft
  - npm i @azure/storage-blob
  - Azure: https://azure.microsoft.com/en-us/free (5GB - 12 months)

* Google
  - npm i @google-cloud/storage
  - GCloud: https://cloud.google.com/free (5GB - US)

* IBM
  - npm i ibm-cos-sdk
  - IBM: https://www.ibm.com/cloud/free (25GB)

* Oracle
  - npm i aws-sdk
  - OCI: https://www.oracle.com/cloud/free (10GB)
  - Uses S3 compatibility API
  - Cannot create new public buckets
```

Other service providers can be integrated similarly except for credential verification.

```javascript
// Optional fields are supported by all services

{
  "selector": "#picture1",
  "type": "image",
  "commands": [
    "png(100x200){90,180,270}" // Uploaded with UUID filename
  ],
  "cloudStorage": [
    {
      "service": "aws",
      "bucket": "squared-001",
      "credential": {
        "accessKeyId": "**********",
        "secretAccessKey": "**********",
        "region": "us-west-2", // Custom properties are sent to the S3 client (optional)
        "sessionToken": "**********" // optional
      },
      "credential": "main", // OR: Load host configuration from settings at instantiation
      "upload": {
        "active": false, // Rewrites "src" to cloud storage location (optional)
        "localStorage": false, // Remove current file from archive or local disk (optional)
        "filename": "picture1.webp", // Choose a different bucket filename (optional)
        "all": false, // Include transforms (optional)
        "overwrite": false // Always use current filename (optional)
      },
      "download": {
        "filename": "picture2.png",
        "versionId": "12345", // Retrieve a previous file snapshot (optional)
        "pathname": "download/images", // File adjacent or base directory when omitted (optional: Overrides "preservePath")
        "active": false, // Always write file or rename to main file when same extension (optional)
        "overwrite": false, // Always write file (optional)
        "deleteObject": false // Remove if download success (optional)
      }
    },
    {
      "service": "azure",
      "bucket": "squared-002",
      "credential": {
        "accountName": "**********", // +1 password option (required)
        "accountKey": "**********",
        "connectionString": "**********",
        "sharedAccessSignature": "**********"
      },
      "upload": {
        "pathname": "a/b/c/", // Virtual directory in bucket (optional: Overrides "preservePath")
        "endpoint": "http://squaredjs.azureedge.net/squared-002" // e.g. CDN (optional)
      }
    },
    {
      "service": "gcloud",
      "bucket": "squared-003", // UUID generated when omitted (optional)
      "credential": {
        "keyFilename": "./gcloud.json" // Path to JSON credentials
      },
      "admin": {
        "publicRead": false, // New buckets (optional: Not supported OCI)
        "emptyBucket": false, // More convenient than using "overwrite" (optional),
        "preservePath": false // Use current pathname as file prefix
      },
      "upload": {
        "active": false, // Implicity "publicRead: true" except when explicitly "publicRead: false"
        "publicRead": false // User with "admin" privileges (optional: Not supported Azure and OCI)
      }
    },
    {
      "service": "ibm",
      "bucket": "squared-004",
      "credential": {
        "apiKeyId": "**********",
        "serviceInstanceId": "**********",
        "region": "us-south",
        "endpoint": "https://s3.us-south.cloud-object-storage.appdomain.cloud" // Same as region (optional)
      }
    },
    {
      "service": "oci",
      "bucket": "squared-005", // New buckets are private when using S3 API
      "credential": {
        "region": "us-phoenix-1",
        "namespace": "abcdefghijkl",
        "accessKeyId": "**********",
        "secretAccessKey": "**********"
      }
    }
  ]
}
```

NOTE: Using S3 and OCI at the same time with identical bucket names causes a conflict with the S3 region cache.

- [YAML](https://github.com/anpham6/squared-functions/blob/master/examples/cloud.selector.yml)
- [TOML](https://github.com/anpham6/squared-functions/blob/master/examples/cloud.selector.toml)

Serving CSS files from cloud storage or CDN requires every image inside the file to be hosted with an absolute URL.

```javascript
squared.saveAs("index.zip", {
    configUri: "http://localhost:3000/chrome/bundle.yml",
    saveAs: {
        html: {
            cloudStorage: [{ // Create static website
                service: "aws",
                bucket: "squared-001",
                settings: "main",
                upload: {
                    active: true,
                    endpoint: "https://squared-001.s3.us-west-2.amazonaws.com",
                    overwrite: true
                }
            }]
        },
        image: { // Non-element images using url() method
            cloudStorage: [{
                service: "aws",
                bucket: "squared-001",
                settings: "main",
                upload: {
                    active: true
                }
            }]
        }
    }
});
```

Inline commands are not supported when using cloud features.

### Data Source

Static content can be generated using an AssetCommand with the "dataSource" property to perform basic text and attribute replacement. 

#### Cloud

Each DocumentDB provider has a different query syntax. Consulting their documentation is recommended if you are writing advanced queries.

```xml
* Amazon DynamoDB
  - npm i aws-sdk
  - AWS: https://aws.amazon.com/dynamodb (25GB + 25 RCU/WCU)

* Microsoft Cosmos DB
  - npm i @azure/cosmos
  - Azure: https://azure.microsoft.com/en-us/services/cosmos-db (5GB + 400RU/s)

* Google Firestore / BigQuery
  - npm i @google-cloud/firestore
  - npm i @google-cloud/bigquery
  - GCloud: https://cloud.google.com/firestore (1GB + 50K/20K r/w@day)
            https://cloud.google.com/bigquery (10GB + 1TB queries/month)

* IBM Cloudant
  - npm i @cloudant/cloudant
  - IBM: https://www.ibm.com/cloud/cloudant (1GB + 20/10 r/w@sec)

* Oracle Autonomous DB
  - npm i oracledb
  - OCI: https://www.oracle.com/autonomous-database (20GB)
         https://www.oracle.com/autonomous-database/autonomous-json-database (Paid - 1TB)
```

```javascript
interface CloudDatabase {
    source: "cloud"; // squared 2.5 (required)
    name?: string;
    table?: string; // Required except when using BigQuery
    id?: string;
    query?: string | PlainObject | any[];
    value?: string | ObjectMap<string | string[]>; // Uses innerHTML for replacement when undefined
    params?: unknown[];
    options?: PlainObject;
    index?: number;
    limit?: number;
    viewEngine?: {
        name: string; // npm package name
        singleRow?: boolean; // Template result data is sent as Array[]
        options?: {
            compile?: PlainObject; // template = engine.compile(value, options)
            output?: PlainObject; // template({ ...options, ...result[index] })
        };
    };
}
```

View engines with a "compile" template string to function (e.g. [EJS](https://ejs.co)) can be used instead for "text" and "attribute". Manual NPM installation (npm i ejs) is required. Results from any data sources are treated as an array with multiple rows being concatenated into one string.

```javascript
// NOTE: "cloudDatabase" has been deprecated as of sqaured 2.5 (dataSource)

/* AWS: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GettingStarted.NodeJs.html */
{
  "selector": ".card:nth-of-type(1) p",
  "type": "text",
  "dataSource": {
    "source": "cloud",
    "service": "aws",
    "credential": {
      "accessKeyId": "**********",
      "secretAccessKey": "**********",
      "region": "us-east-1", // Endpoint specified (optional)
      "endpoint": "https://dynamodb.us-east-1.amazonaws.com" // Local development (required) 
    },
    "table": "demo",
    "query": {
      "KeyConditionExpression": "#name = :value",
      "ExpressionAttributeNames": { "#name": "id" },
      "ExpressionAttributeValues": { ":value": "1" }
    },
    "limit": 1, // optional
    "value": "<b>${title}</b>: ${description}" // Only one field per template literal (optional)
  }
}

/* Azure: https://docs.microsoft.com/en-us/azure/cosmos-db/sql-query-getting-started */
{
  "selector": ".card:nth-of-type(1) p",
  "type": "text",
  "dataSource": {
    "source": "cloud",
    "service": "azure",
    "credential": {
      "endpoint": "https://squared-001.documents.azure.com:443",
      "key": "**********"
    },
    "name": "squared", // Database name (required)
    "table": "demo",
    "partitionKey": "Pictures", // optional
    "query": "SELECT * FROM c WHERE c.id = '1'", // OR: storedProcedureId + partitionKey? + params?
    "value": "<b>${__index__}. ${title}</b>: ${description}" // "__index__": Result row index value
  }
}

/* GCloud: https://firebase.google.com/docs/firestore/query-data/queries */
{
  "selector": ".card:nth-of-type(1) p",
  "type": "text",
  "dataSource": {
    "source": "cloud",
    "service": "gcloud",
    "credential": {
      "keyFilename": "./gcloud.json"
    },
    "table": "demo",
    "query": [["group", "==", "Firestore"], ["id", "==", "1"]], // where
    "orderBy": [["title", "asc"]], // optional
    "value": "{{if !expired}}<b>${title}</b>: ${description}{{else}}Expired{{end}}" // Non-nested conditional truthy property checks
  }
}

// BigQuery
{
  "selector": ".card:nth-of-type(1) p",
  "type": "text",
  "dataSource": {
    "source": "cloud",
    "service": "gcloud",
    "credential": {
      "keyFilename": "./gcloud.json"
    },
    "query": "SELECT name, count FROM `demo.names_2014` WHERE gender = 'M' ORDER BY count DESC LIMIT 10",
    "limit": 5 // optional
    "removeEmpty": false, // optional
    "value": "<b>${name}</b>: ${count}"
  }
}

/* IBM: https://github.com/cloudant/nodejs-cloudant#readme */
{
  "selector": ".card:nth-of-type(1) p",
  "type": "text",
  "dataSource": {
    "source": "cloud",
    "service": "ibm",
    "credential": {
      "account": "**********", // IAM and legacy credentials
      "password": "**********",
      "url": "https://<account>:<password>@<account>.cloudantnosqldb.appdomain.cloud" // OR: Service credentials
    },
    "table": "demo",
    "query": { "selector": { "id": { "$eq": "1" } } },
    "value": "<b>${title}</b>: ${description}"
  }
}

/* OCI: https://docs.oracle.com/en/database/oracle/simple-oracle-document-access/adsdi/oracle-database-introduction-simple-oracle-document-access-soda.pdf */
{
  "selector": ".card:nth-of-type(1) p",
  "type": "text",
  "dataSource": {
    "source": "cloud",
    "service": "oci",
    "credential": {
      "user": "**********",
      "password": "**********",
      "connectionString": "tcps://adb.us-phoenix-1.oraclecloud.com:1522/abcdefghijklmno_squared_high.adb.oraclecloud.com?wallet_location=/Users/Oracle/wallet"
    },
    "table": "demo",
    "query": "SELECT d.* from demo NESTED json_document COLUMNS(id, title, description) d WHERE d.id = '1'", // SQL: Column names might be UPPERCASED
    "query": { "id": { "$eq": "1" } }, // SODA
    "value": "<b>${title}</b>: ${description}"
  }
}
```

```javascript
// Retrieval using ID is supported by all providers

{
  "selector": ".card:nth-of-type(2) img",
  "type": "attribute",
  "dataSource": {
    "source": "cloud", // squared 2.5
    "service": "azure",
    "credential": "db-main",
    "name": "squared", // Azure (required)
    "table": "demo",
    "id": "2", // OCI (server assigned)
    "partitionKey": "Pictures", // AWS (required) | Azure and IBM (optional)
    "value": { // Result: { src: "", other: {} }
      "src": "src", // Use direct property access
      "alt": "{{if !expired}}other.alt{{else}}:text(Expired){{end}}", // Only one conditional per attribute
      "style": [":join(; )" /* optional: " " */, "other.style[0]", "other.style[1]", ":text(display: none)"] // Same as: [":join(; )", "other.style", ":text(display: none)"]
    }
  }
}
```

Some queries use an optional parameters array (params) or configuration object (options) which is sent with the query when applicable. If you require this advanced usage then further instructions can be found in the database provider documentation.

When in development mode you can save read units by setting a timeout value for the DB cache.

```javascript
// squared.settings.json

"cloud": {
  "cache": {
    "aws": 0, // No cache per reload
    "azure": 60, // 1 minute
    "gcloud": 86400 // 1 day
  }
}
```

Results are cached using the supplied credentials and queries will individually be cleared when the amount of time has expired.

Reusing configuration templates is possible using URL query parameters. Output values cannot be modified with the {{param}} syntax.

```javascript
// http://localhost:3000/project/index.html?table=demo&id=1

{
  "service": "azure",
  "credential": "db-main",
  "name": "squared",
  "table": "{{table}}",
  "partitionKey": "Pictures",
  "query": "SELECT * FROM c WHERE c.id = '{{id}}'",
  "value": "<b>${title}</b>: ${description}" // Not parsed
}
```

#### MongoDB

Local development may be faster using MongoDB instead of a cloud DocumentDB. It is completely free to use and includes a GUI data explorer as well.

```xml
* MongoDB Community Server
  - npm i mongodb
  - https://www.mongodb.com/try/download/community
  - https://mongodb.github.io/node-mongodb-native/3.3/tutorials/connect/authenticating (credential)
  - https://docs.mongodb.com/compass/master/query/filter (query)
```

MongoDB Atlas installations also use the "mongodb" source format. All MongoDB authentication mechanisms are supported.

```javascript
interface MongoDataSource {
    source: "mongodb"
    uri?: string; // Connection string
    credential?: string | StandardMap;
    query?: FilterQuery<any>;
    value?: string | ObjectMap<string | string[]>;

    // Same as CloudDatabase (except no "id")
}
```

```javascript
// http://localhost:3000/project/index.html?id=1

{
  "selector": ".card:nth-of-type(1) img",
  "type": "attribute",
  "dataSource": {
    "source": "mongodb",

    // Choose one (required)
    "uri": "mongodb://username@password:localhost:27017",
    "credential": { // Same as cloud database "db-main" (settings)
      "user": "**********",
      "pwd": "**********",
      "server": "localhost:27017",
      "dnsSrv": false,
      "authMechanism": "MONGODB-X509",
      "sslKey": "/absolute/path/ssl/x509/key.pem",
      "sslCert": "/absolute/path/ssl/x509/cert.pem",
      "sslValidate": false
    },

    "query": {
      "id": {
        "$eq": "{{id}}"
      },
      "name": {
        "$regex": "mongodb.*\\.com", // $regex: /mongodb.*\.com/si
        "$options": "si"
      },
      "start_date": {
        "$gt": "$date=2021-01-01" // new Date("2021-01-01")
      },
      "$in": ["$regex=/^mongodb/i"], // [/^mongodb/i]
      "$where": "$function=function() { return this.name == 'mongodb.com'; }"
    },
    "value": "<b>${name}</b>: ${count}"
  }
}

// IF conditional to completely remove an element (outerHTML)
{
  "selector": "div.card",
  "type": "display",
  "dataSource": {
    "source": "mongodb",
    "uri": "mongodb://localhost:27017",
    "removeEmpty": true, // Includes invalid conditions (optional)

    // Required
    "value": "attr1", // Remove when: null or undefined
    "value": "-attr2", // Remove when: attr2=falsey
    "value": "+attr3", // Remove when: attr3=truthy
    "value": ["attr1" /* AND */, ":logical(OR)", "-attr2" /* OR */, "-attr3" /* OR */, ":logical(AND)", "+attr4" /* AND */] // Remove when: attr1=null + attr2|attr3=falsey + attr4=truthy
  }
}
```

Display block conditionals are performed after all update queries have been executed since updating a removed element can be an error when document ids are not available. To remove an element all AND conditions have to be TRUE and one OR per group is TRUE. Using a view engine is recommended if you require a more advanced conditional statement.

Returning an empty result or a blank string (view engine) is FALSE.

#### Data Interchange

Using the same concept from databases you can also read from JSON/YAML/TOML file formats.

```javascript
interface UriDataSource {
    source: "uri";
    format: string; // json | yaml | toml
    uri: string;
    query?: string; // Uses JSONPath <https://github.com/dchester/jsonpath>

    // Same as CloudDatabase (except no "id")
}
```

```javascript
// http://localhost:3000/project/index.html?file=demo

{
  "selector": ".card:nth-of-type(1) img",
  "type": "attribute",
  "dataSource": {
    "source": "uri",
    "format": "json",
    "uri": "http://localhost:3000/project/{{file}}.json", // Local files require read permissions
    "query": "$[1]" // Row #2 in result array (optional)
    "value": { // Result: { src: "", other: {} }
      "src": "src",
      "alt": "other.alt"
    }
  }
}
```

View engines can also be used to format the element "value" or innerHTML with any data source.

### Options: Development / Production

The entire page can similarly be transformed as a group using the "saveAs" attribute in options. Cloud storage can be used for all assets (except HTML) using the same configuration as element selectors.

```javascript
squared.saveAs("index.zip", {
    productionRelease: false || true || "/absolute/path/wwwroot/", // Ignore local url rewriting and load assets using absolute paths
    preserveCrossOrigin: false, // Ignore downloading a local copy of assets hosted on other domains
    useOriginalHtmlPage: false, // May produce better results when using custom elements

    removeInlineStyles: false, // Strip style="" attribute from all elements (useOriginalHtmlPage: false)
    removeUnusedClasses: false, // CSS classes that can be removed in current state
    removeUnusedSelectors: false, // CSS selectors [:first-child] that can be removed in current state (not recommend for pages with forms [:valid] and active states [:hover])
    retainUsedStyles: [/* css selectors */], // Styles that should be kept which are used later with JavaScript

    // All attributes are optional except "filename" for <script> and <link>.
    saveAs: {
        html: { filename: "index.html", format: "beautify", attributes: [{ name: "lang", value: "en" }] },
        script: { pathname: "../js", filename: "bundle.js", format: "es5+es5-minify" },
        link: { pathname: "css", filename: "bundle.css", preserve: true, inline: true },
        image: { inline: true },
        font: {
            pathname: "fonts",
            blob: false,
            customize: (uri, mimeType, command) => { // script | link | image | font
                if (mimeType === "font/ttf") {
                    command.blob = true;
                    return "filename.ttf";
                }
                return ""; // Do not alter filename
            }
        }
    }
}); 
```

File watching is available with "copy" methods and uses HTTP HEAD requests to determine modifications. Hot reload will automatically reload your browser when the file modification has been fully transformed.

```javascript
// js | css | image

{
  "selector": "link",
  "type": "css",
  "watch": {
    "interval": 100,
    "expires": "1h 1m 1s",
    "reload": { // true
      "socketId": "111-111-111" // Use same ID to reload multiple pages (optional)
      "port": 80 // optional
      "secure": false // Requires SSL key and cert (optional)
      "module": false // "img" and "link" only (optional)
    }
  },
  "process": [
    "bundle",
    "minify"
  ],
  "cloudStorage": [
    {
      "service": "aws",
      "bucket": "squared-001",
      "credential": "main",
      "upload": {
        "active": true
      }
    }
  ]
}

squared.copyTo("/local/user/www", {
    watch: true,
    saveAs: {
        script: { pathname: "../js", format: "es5+es5-minify", watch: true },
        link: { pathname: "css", filename: "bundle.css", watch: { interval: 500 } }
    }
});
```

Hot module replacement is only available for LINK[href] and IMG[src] elements. It is disabled by default due to possible conflicts with preloaded JavaScript.

```xml
<!-- chrome -->
<script src="/common/util.js" data-chrome-watch="1000::1h 30m::111-111-111:8080[module]"></script> <!-- "~" can be used for default value -->

<!-- android -->
<img src="images/harbour1.jpg" data-android-watch="true">
```

You can also watch any file that is served with HTTP including files from a different server. The HTML page itself or any inlined assets cannot be watched since changing the DOM structure requires a browser reload.

### Asset exclusion

You can exclude unnecessary processing files using the dataset attribute in &lt;script|link|style&gt; tags. Other elements can only be excluded when using a configuration file.

```xml
<script data-chrome-file="exclude" src="/dist/squared.js"></script>
<script data-chrome-file="exclude" src="/dist/squared.base.js"></script>
<script data-chrome-file="exclude" src="/dist/chrome.framework.js"></script>
<script data-chrome-file="exclude">
    squared.setFramework(chrome);
    squared.save();
</script>
```

You can similarly prevent any element from being downloaded or transformed using the "ignore" command.

```xml
<iframe src="https://www.google.com/maps" data-chrome-file="ignore"></iframe>
```

### LICENSE

MIT