## squared-functions 0.12

These are the available options when creating archives or copying files. Examples use squared 2.3 although the concepts can be used similarly with any NodeJS application.

### Image

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

npm i dwebp-bin && npm i cwebp-bin

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
// Multiple transformations use the "::" as the separator with "data-chrome-commands"

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

// HTML configuration (json/yaml)
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

### Gulp

Tasks can be performed with Gulp to take advantage of their pre-built plugin repository. Gulp is the final stage preceding archiving or copying after file content has been downloaded and transformed.

* [npm i -g gulp-cli && npm i gulp](https://gulpjs.com/docs/en/getting-started/quick-start)

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
const options = {
    assets: [
        {
            pathname: 'images',
            filename: 'pencil.png',
            mimeType: 'image/png',
            commands: ['jpeg', 'bmp@(50000,100000)'],
            tasks: [{ handler: 'gulp', task: 'compress' }],
            uri: 'http://localhost:3000/common/images/pencil.png'
        }
    ]
};
```

```xml
<!-- chrome -->
<script src="/common/system.js" data-chrome-tasks="gulp:minify+gulp:beautify:true"></script>

<!-- android -->
<img src="https://s3-us-west-2.amazonaws.com/s.cdpn.io/12005/harbour1.jpg" data-android-tasks="gulp:compress" />
```

NOTE: SRC (temp) and DEST (original) always read and write to the current directory.

```javascript
// gulpfile.js

const gulp = require('gulp');
const uglify = require('gulp-uglify');
 
gulp.task('minify', () => {
  return gulp.src('*')
    .pipe(uglify())
    .pipe(gulp.dest('./'));
});
```

Renaming files with Gulp is not recommended. It is better to use the "saveAs" or "filename" attributes when the asset is part of the HTML page.

### CHROME: Saving web page assets

Bundling options are available with these HTML tag names.

* saveAs: html + script + link
* exportAs: script + style
* exclude: script + link + style

Files with the same path and filename will automatically create a bundle assuming there are no conflicts in call ordering.

```javascript
// HTML configuration (json/yaml) is recommended

{
  "selector": "head > script:nth-of-type(2), head > script:nth-of-type(3)",
  "type": "js",
  "saveAs": "js/modules2.js"
}
```

JS and CSS files can be bundled together with the "saveAs" or "exportAs" action. Multiple transformations per asset can be chained using the "+" symbol. Whitespace can be used between anything for readability.

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
```

NOTE: Placing the "chrome" dataset commands at the end is recommended especially if you are using the ">" character in your attributes. When possible use the "&amp;gt;" entity instead.

```xml
<!-- Required: Lowercase tag names and attributes with no extra spaces -->

<link rel="stylesheet" href="css/dev.css" data-chrome-file="saveAs:css/prod.css::beautify" data-chrome-options="preserve|inline" />
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

### Raw assets

```xml
<!-- img | video | audio | source | track | object | embed | iframe -->

<img src="https://s3-us-west-2.amazonaws.com/s.cdpn.io/12005/harbour1.jpg"
     data-chrome-file="saveAs:images/harbour.jpg"
     data-chrome-options="compress" />
```

You can use images commands with saveTo (directory) on any element where the image is the primary display output.

```xml
<!-- img | object | embed | iframe -->

<img src="https://s3-us-west-2.amazonaws.com/s.cdpn.io/12005/harbour1.jpg"
     data-chrome-file="saveTo:../images/harbour"
     data-chrome-commands="png(10000,75000)(800x600[bezier]^contain[right|bottom])"
     data-chrome-options="compress|inline" />
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

These particular plugins can be configured using a plain object literal. Manual installation is required when using any of these packages [<b>npm run install-chrome</b>]. Transpiling with Babel is also configurable with a .babelrc file in the base folder for any presets and additional settings. Other non-builtin minifiers can similarly be applied and chained by defining a custom string-based synchronous function.

Custom plugins can also be installed from NPM. The asynchronous function has to be named "transform" for validation purposes. The only difference is the context object is set to the Document module. Examples can be found in the "chrome/packages" folder.

* Function object
* file relative to serve.js
* function closure

```javascript
// squared.settings.json: chrome -> html | js | css -> npm package name -> process name

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
        "minify-example": "function (context, value, options, resolve) { resolve(context.minify(value, options.outputConfig).code); }", // "minify-example-output" creates variable "options.outputConfig"
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
          "plugins": ["autoprefixer", "cssnano"] // Plugins have be installed with NPM manually
        }
      },
      "sass": { // npm i sass
        "sass-example": "function (context, value, options, resolve) { resolve(context.renderSync({ ...options.outputConfig, data: value }, functions: {}).css); }"
      }
    }
  }
}
```

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
    outputConfig: StandardMap;
    sourceMap: SourceMapInput;
    writeFail: ModuleWriteFailMethod;
}

// Custom inline and template functions use Promise "resolve" callbacks

function (context, value, options, resolve) {
    context.transform(value, options.outputConfig, function(err, result) {
        if (!err && result) {
            resolve(result.code);
        }
        else {
            resolve();
        }
    });
}
```

The same concept can be used inline anywhere using a &lt;script&gt; tag with the type attribute set to "text/template". The script template will be completely removed from the final output.

```javascript
// "es5-example" is a custom name (chrome -> eval_template: true)

<script type="text/template" data-chrome-template="js::@babel/core::es5-example">
function (context, value, options, resolve) {
    const options = { ...options.outputConfig, presets: ['@babel/preset-env'], sourceMaps: true }; // <https://babeljs.io/docs/en/options>
    const result = context.transformSync(value, options);
    if (result) {
        if (result.map) {
            options.sourceMap.nextMap('babel', result.code, result.map);
        }
        resolve(result.code);
    }
    else {
        resolve();
    }
}
</script>
```

Here is the equivalent configuration in YAML and when available has higher precedence than JSON.

- [squared.settings.json](https://github.com/anpham6/squared-functions/blob/master/examples/squared.settings.json)
- [squared.settings.yml](https://github.com/anpham6/squared-functions/blob/master/examples/squared.settings.yml)

### Modifying content attributes

There are possible scenarios when a transformation may cause an asset type to change into another format.

```xml
<!-- before -->
<link id="sass-example" rel="alternate" type="text/plain" href="css/dev.sass" />
```

Using element "id" is recommended when there are multiple elements with identical structure and content. Similar to JSON use only double quotes (or &amp;quot;) and do not use unnecessary extra spaces. Tags that are not well-formed may fail to be replaced.

```javascript
{
  "selector": "#sass-example",
  "type": "css",
  "filename": "prod.css",
  "attributes": {
      "id": undefined,
      "rel": "stylesheet",
      "type": "text/css",
      "title": "",
      "disabled": null
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

You can also use the workspace feature in [squared-express](https://github.com/anpham6/squared-express#readme) to precompile text assets during development.

### External configuration

JSON (json/js) configuration is optional and is provided for those who prefer to separate the bundling and transformations from the HTML. Any assets inside the configuration file will override any settings either inline or from JavaScript. You can also use the equivalent in YAML (yml/yaml) for configuring as well.

```javascript
interface OutputModifiers {
    inline?: boolean; // type: js | css | image (base64)
    blob?: boolean; // type: image (base64)
    preserve?: boolean; // type: css
    ignore?: boolean;
    exclude?: boolean
}

interface AssetCommand extends OutputModifiers {
    selector?: string;
    type?: string;
    saveAs?: string; // type: js | css
    exportAs?: string; // type: js | css
    saveTo?: string; // type: image | video | audio (transforms create multiple files and are given a UUID filename)
    pathname?: string; // alias for "saveTo"
    filename?: string; // type: html | ...image
    process?: string[]; // type: js | css
    commands?: string[]; // type: image
    cloudStorage?: CloudService[];
    attributes?: { [key: string]: value?: Null<string> };
    tasks?: string[];
    watch?: boolean | { interval?: number, expires?: string }; // type: js | css | image (expires: 1h 1m 1s)
    template?: {
        module: string;
        identifier?: string;
        value?: string;
    };
}
```

- [bundle.json](https://github.com/anpham6/squared/blob/master/html/chrome/bundle.json)
- [bundle.yml](https://github.com/anpham6/squared/blob/master/html/chrome/bundle.yml)

```javascript
squared.saveAs('bundle.zip', { configUri: 'http://localhost:3000/chrome/bundle.yml' });
```

Here is the equivalent page using only inline commands with "data-chrome-file" and "data-chrome-tasks".

- [bundle_inline.html](https://github.com/anpham6/squared/blob/master/html/chrome/bundle_inline.html)

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

- [cloud.selector.yml](https://github.com/anpham6/squared-functions/blob/master/examples/cloud.selector.yml)

Serving CSS files from cloud storage or CDN requires every image inside the file to be hosted with an absolute URL.

```javascript
squared.saveAs('index.zip', {
    configUri: 'http://localhost:3000/chrome/bundle.yml',
    saveAs: {
        html: {
            cloudStorage: [{ // Create static website
                service: 'aws',
                bucket: 'squared-001',
                settings: 'main',
                upload: {
                    active: true,
                    endpoint: 'https://squared-001.s3.us-west-2.amazonaws.com',
                    overwrite: true
                }
            }]
        },
        image: { // Non-element images using url() method
            cloudStorage: [{
                service: 'aws',
                bucket: 'squared-001',
                settings: 'main',
                upload: {
                    active: true
                }
            }]
        }
    }
});
```

Inline commands are not supported when using cloud features.

### Cloud database

Basic text replacement can be achieved using any of these cloud based document databases. Each provider has a different query syntax and consulting their documentation is recommended.

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
// NOTE: Attribute "table" is required except when using BigQuery

interface CloudDatabase {
    table: string;
    value: string | ObjectMap<string | string[]>;
    name?: string;
    id?: string;
    query?: string | PlainObject | any[];
    limit?: number;
    params?: unknown[];
    options?: PlainObject;
}

/* AWS: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GettingStarted.NodeJs.html */
{
  "selector": ".card:nth-of-type(1) p",
  "type": "text",
  "cloudDatabase": {
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
    "value": "<b>${title}</b>: ${description}" // Only one field per template literal
  }
}

/* Azure: https://docs.microsoft.com/en-us/azure/cosmos-db/sql-query-getting-started */
{
  "selector": ".card:nth-of-type(1) p",
  "type": "text",
  "cloudDatabase": {
    "service": "azure",
    "credential": {
      "endpoint": "https://squared-001.documents.azure.com:443",
      "key": "**********"
    },
    "name": "squared", // Database name (required)
    "table": "demo",
    "partitionKey": "Pictures", // optional
    "query": "SELECT * FROM c WHERE c.id = '1'", // OR: storedProcedureId + partitionKey? + params?
    "value": "<b>${title}</b>: ${description}"
  }
}

/* GCloud: https://firebase.google.com/docs/firestore/query-data/queries */
{
  "selector": ".card:nth-of-type(1) p",
  "type": "text",
  "cloudDatabase": {
    "service": "gcloud",
    "credential": {
      "keyFilename": "./gcloud.json"
    },
    "table": "demo",
    "query": [["group", "==", "Firestore"], ["id", "==", "1"]], // where
    "orderBy": [["title", "asc"]], // optional
    "value": "<b>${title}</b>: ${description}"
  }
}

// BigQuery
{
  "selector": ".card:nth-of-type(1) p",
  "type": "text",
  "cloudDatabase": {
    "service": "gcloud",
    "credential": {
      "keyFilename": "./gcloud.json"
    },
    "query": "SELECT name, count FROM `demo.names_2014` WHERE gender = 'M' ORDER BY count DESC LIMIT 10",
    "limit": 5 // optional
    "value": "<b>${name}</b>: ${count}"
  }
}

/* IBM: https://github.com/cloudant/nodejs-cloudant#readme */
{
  "selector": ".card:nth-of-type(1) p",
  "type": "text",
  "cloudDatabase": {
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
  "cloudDatabase": {
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
  "cloudDatabase": {
    "service": "azure",
    "credential": "db-main",
    "name": "squared", // Azure (required)
    "table": "demo",
    "id": "2", // OCI (server assigned)
    "partitionKey": "Pictures", // AWS (required) | Azure and IBM (optional)
    "value": {
      "src": "imageData.src", // Template literal syntax is not supported
      "style": [":join(; )" /* optional: " " */, "imageData.style[0]", "imageData.style[1]"]
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
// http://localhost:3000/index.html?table=demo&id=1

{
  "service": "azure",
  "credential": "db-main",
  "name": "squared",
  "table": "{{table}}", // Params should always be quoted
  "partitionKey": "Pictures",
  "query": "SELECT * FROM c WHERE c.id = '{{id}}'",
  "value": "<b>${title}</b>: ${description}" // Not parsed
}
```

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
        image: { inline: true },
        base64: { commands: ['png'] }
    }
}); 
```

```javascript
// js | css | image | video | audio

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
      "service": "aws",
      "bucket": "squared-001",
      "credential": "main",
      "upload": {
        "active": true
      }
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

File watching is available and uses HTTP HEAD requests to determine modifications. You can also watch any file that is served using HTTP on a different server or computer. The HTML page itself or any inlined assets cannot be watched since changes to the DOM structure requires a complete browser reload.

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