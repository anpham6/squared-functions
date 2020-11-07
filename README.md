### squared-functions 0.3

These are some of the available options when creating archives or copying files with squared 2.1.

```javascript
// NOTE: format: zip | tar | gz/tgz | compress: gz | br

squared.settings.outputArchiveFormat = 'tar'; // default format "zip"

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
    exclusions: { // All attributes are optional
        pathname: ['app/build', 'app/libs'],
        filename: ['ic_launcher_foreground.xml'],
        extension: ['iml', 'pro'],
        pattern: ['outputs', 'grad.+\\.', '\\.git']
    }
});
```

Image conversion can be achieved using the mimeType property in a RequestAsset object. The supported formats are:

* png - r/w
* jpeg - r/w
* bmp - r/w
* gif - r
* tiff - r

```javascript
// All commands are optional except "format". Outer groupings and inner brackets are required.

+ <format>

- @|%
- ( minSize(n,0) , maxSize(n,*) )
- ( width(n|auto) x height(n|auto) [bilinear|bicubic|hermite|bezier]? ^(cover|contain|scale)?[left|center|right|top|middle|bottom]? #background-color? )
- ( left(+|-n) , top(+|-n) | cropWidth(n) x cropHeight(n) )
- { ...rotate(n) #background-color? }
- | opacity(d) |
```

@ - replace  
% - smaller

Placing an @ symbol (png@) after the format will remove the original file from the package. Using the % symbol (png%) instead will choose the smaller of the two files. You can also use these commands with the setting "convertImages" in the Android framework.

```javascript
// NOTE: Multiple transformations per asset use the ':' as the separator when using "data-chrome-file"

png(50000,*)(800x600[bezier]^contain[right|bottom]#FFFFFF)(-50,50|200x200){45,135,215,315#FFFFFF}|0.5|
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

### CHROME: Saving web page assets

Bundling options are available with these HTML tag names.

* saveAs: html + script + link
* exportAs: script + style
* exclude: script + link + style

JS and CSS files can be optimized further using these settings (node-express):

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
* [npm i prettier](https://github.com/prettier/prettier)
* [npm i clean-css](https://github.com/jakubpawlowicz/clean-css)
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
        "minify-example": "function(context, value, config) { return context.minify(value, config).code; }", // "minify-example-config" creates scoped variable "config"
        "minify-example-config": {
          "keep_classnames": true
        }
      },
      "@babel/core": {
        "es5-example": "./es5.js" // startsWith('./ | ../')
      },
      "rollup": {
        "bundle": "./rollup.config.js",
        "bundle-es6": {
          "external": ["lodash"]
        },
        "bundle-es6-config": "./rollup.output.config.js" // supplemental JSON configuration settings use the "-config" suffix
      }
    },
    "css": {
      "node-sass": { // npm i node-sass
        "sass-example": "function(context, value) { return context.renderSync({ data: value }, functions: {}); }" // first transpiler in chain
      }
    }
  }
}
```

```javascript
// es5.js

function (context, value, config /* optional: "@babel/core-config" */) {
    const options = { presets: ['@babel/preset-env'] }; // <https://babeljs.io/docs/en/options>
    return context.transformSync(value, options).code;
}
```

The same concept can be used inline anywhere using a &lt;script&gt; tag with the type attribute set to "text/template". The script template will be completely removed from the final output.

```javascript
// "es5-example" is a custom name (chrome -> eval_text_template: true)

<script type="text/template" data-chrome-template="js::@babel/core::es5-example">
    function (context, value, config /* optional */) {
        const options = { ...config, presets: ['@babel/preset-env'] };
        return context.transformSync(value, options).code;
    }
</script>
```

Here is the equivalent YAML settings and when available has higher precedence than JSON settings.

- [squared.settings.yml](https://github.com/anpham6/squared-functions/blob/master/examples/squared.settings.yml)

### Gulp

Tasks can similarly be performed with Gulp when using YAML/JSON configuration to take advantage of their pre-built plugin repository. Gulp is the final stage preceding archiving or copying after file content has been finalized.

* [npm install -g gulp-cli && npm install gulp](https://gulpjs.com/docs/en/getting-started/quick-start)

```javascript
// squared.settings.json

"gulp": {
  "minify": "./gulpfile.js"
}
```

```javascript
- selector: head > script:nth-of-type(1)
  type: js
  tasks:
    - minify
    - beautify
```

```xml
<script data-chrome-tasks="minify+beautify" src="/common/system.js"></script>
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

### Bundling

JS and CSS files can be bundled together with the "saveAs" or "exportAs" action. Multiple transformations per asset can be chained using the "+" symbol. The "preserve" command will prevent unused styles from being deleted.

```xml
<link data-chrome-file="saveAs:css/prod.css::beautify::preserve|inline" rel="stylesheet" href="css/dev.css" />
<style data-chrome-file="exportAs:css/prod.css::minify+beautify">
    body {
        font: 1em/1.4 Helvetica, Arial, sans-serif;
        background-color: #fafafa;
    }
</style>
<script data-chrome-file="saveAs:js/bundle1.js::minify" src="/dist/squared.js"></script>
<script data-chrome-file="saveAs:js/bundle1.js::minify" src="/dist/squared.base.js"></script>
<script data-chrome-file="saveAs:js/bundle2.js" src="/dist/chrome.framework.js"></script>
```

The entire page can similarly be transformed as a group using the "saveAs" attribute in options. Extension plugins will still be applied to any qualified assets.

```javascript
const options = {
    saveAs: { // All attributes are optional
        html: { filename: 'index.html', format: 'beautify' },
        script: { pathname: '../js', filename: 'bundle.js', format: 'es5+es5-minify' },
        link: { pathname: 'css', filename: 'bundle.css', preserve: true, inline: true },
        image: { format: 'base64' },
        base64: { format: 'png' }
    }
};
```

There are a few ways to save the entire page or portions using the system methods.

```javascript
squared.saveAs('index.zip', { // default is false
    removeUnusedStyles: true, // Use only when you are not switching classnames with JavaScript
    productionRelease: true, // Ignore local url rewriting and load assets using absolute paths
    preserveCrossOrigin: true // Ignore downloading a local copy of assets hosted on other domains
}); 
```

The file action commands (save | saveAs | copyTo | appendTo) should only be used one at a time in the Chrome framework. Calling multiple consecutively may conflict if you do not use async/await.

### Command: saveTo

You can use images commands with saveTo on any element when the image is the primary display output. Encoding with base64 is also available using the "::base64" commmand as the third argument.

```xml
<!-- NOTE: img | video | audio | source | track | object | embed | iframe -->

saveTo: directory (~same) :: transformations? (~image) :: compress?|base64? (image)

<img
    id="image1"
    src="https://s3-us-west-2.amazonaws.com/s.cdpn.io/12005/harbour1.jpg"
    data-chrome-file="saveTo:../images/harbour::png@(10000,75000)(800x600[bezier]^contain[right|bottom])::base64|compress" /> <!-- "saveTo:~::~::base64" -->
```

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

### YAML/JSON configuration

YAML (yml/yaml) configuration is optional and is provided for those who prefer to separate the bundling and transformations from the HTML. Any assets inside the configuration file will override any settings either inline or from JavaScript. You can also use the equivalent in JSON (json/js) for configuring as well.

```javascript
interface FileModifiers {
    preserve?: boolean; // type: css
    inline?: boolean; // type: js | css
    compress?: boolean; // type: image
    base64?: boolean; // type: image
    ignore?: boolean;
    exclude?: boolean;
}

interface AssetCommand extends FileModifiers {
    selector?: string;
    type?: string;
    saveAs?: string; // type: js | css
    exportAs?: string; // type: js | css
    saveTo?: string; // type: image | video | audio (transforms create multiple files and are given a UUID filename)
    pathname?: string; // alias for "saveTo"
    filename?: string; // type: html | ...image
    process?: string[]; // type: js | css
    commands?: string[]; // type: image
    tasks?: string[];
    template?: {
        module?: string;
        identifier?: string;
        value?: string;
    };
}
```

- [bundle.yml](https://github.com/anpham6/squared/blob/master/html/chrome/bundle.yml)
- [bundle.json](https://github.com/anpham6/squared/blob/master/html/chrome/bundle.json)
- [bundle.html](https://github.com/anpham6/squared/blob/master/html/chrome/bundle.html)

```javascript
squared.saveAs('bundle.zip', { configUri: 'http://localhost:3000/chrome/bundle.yml' });
```

Here is the equivalent page with "data-chrome-file" using only inline commands.

- [bundle_inline.html](https://github.com/anpham6/squared/blob/master/html/chrome/bundle_inline.html)

### LICENSE

MIT