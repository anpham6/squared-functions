### squared-functions 0.3

These are some of the available options when creating archives or copying files with squared 2.0.

```javascript
// NOTE: common: zip | tar | gz/tgz | node-express: br | squared-apache: 7z | jar | cpio | xz | bz2 | lzma | lz4 | zstd

squared.settings.outputArchiveFormat = '7z'; // default format "zip"

squared.saveAs('archive1', {
    format: '7z',
    assets: [
        {
            pathname: 'app/src/main/res/drawable',
            filename: 'ic_launcher_background.xml',
            uri: 'http://localhost:3000/common/images/ic_launcher_background.xml',
            compress: [{ format: 'gz', level: 9 }, { format: 'br' }, { format: 'bz2' }, { format: 'lzma' }, { format: 'zstd' }, { format: 'lz4' }]
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

* png
* jpeg
* bmp
* gif
* tiff

node-express has only read support for GIF and TIFF. Opacity can be applied only to PNG and BMP. squared-apache does not support alignment or background color.

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
// NOTE: squared-apache uses TinyPNG <https://tinypng.com/developers> for resizing and refitting (contain|cover|scale) and supports only PNG and JPEG.

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
        "minify-example": "const options = { keep_classnames: true }; return context.minify(value, options).code;" // arguments are always 'context' and 'value'
      },
      "@babel/core": {
        "es5-example": "./es5.js" // startsWith './'
      }
    },
    "css": {
      "node-sass": { // npm i node-sass
        "sass-example": "function (sass, value) { return sass.renderSync({ data: value }, functions: {}); }" // first transpiler in chain
      }
    }
  }
}

// .babelrc
{
  "presets": ["@babel/preset-env"]
}

// es5.js
function (context, value) {
    const options = { presets: ['@babel/preset-env'] }; // <https://babeljs.io/docs/en/options>
    return context.transformSync(value, options).code;
}
```

The same concept can be used inline anywhere using a &lt;script&gt; tag with the type attribute set to "text/template". The script template will be completely removed from the final output.

```javascript
// "es5-example" is a custom name (chrome -> eval_text_template: true)

<script type="text/template" data-chrome-template="js::@babel/core::es5-example">
    function (context, value) {
        const options = { presets: ['@babel/preset-env'] };
        return context.transformSync(value, options).code;
    }
</script>
```

### Bundling

JS and CSS files can be bundled together with the "saveAs" or "exportAs" action. Multiple transformations per asset can be chained using the "+" symbol. The "preserve" command will prevent unused styles from being deleted.

```xml
<link data-chrome-file="saveAs:css/prod.css::beautify::preserve" rel="stylesheet" href="css/dev.css" />
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
        html: { filename: 'index.html', format: 'beautify' }
        script: { pathname: '../js', filename: 'bundle.js', format: 'es5+es5-minify' },
        link: { pathname: 'css', filename: 'bundle.css', preserve: true },
        image: { format: 'base64' },
        base64: { format: 'png' }
    },
    transforms: [
        { id: 'image1', pathname: '../images/harbour', filename: 'image1.png' commands: ['png@(10000,75000)(800x600[bezier]^contain[right|bottom])'], compress: true },
        { id: 'image2', base64: true }
    ]
};
```

There are a few ways to save the entire page or portions using the system methods.

```javascript
squared.saveAs('index', { // default is false
    format: 'zip', // optional
    removeUnusedStyles: true, // Use only when you are not switching classnames with JavaScript
    productionRelease: true, // Ignore local url rewriting and load assets using absolute paths
    preserveCrossOrigin: true // Ignore downloading a local copy of assets hosted on other domains
}); 
```

The file action commands (save | saveAs | copyTo | appendTo) should only be used one at a time in the Chrome framework. Calling multiple consecutively may conflict if you do not use async/await.

### saveTo command

```xml
saveTo: directory (~same) :: transformations? (~image) :: compress?|base64? (image)
```

You can use images commands with saveTo on any element when the image is the primary display output. Encoding with base64 is also available using the "::base64" commmand as the third argument.

```xml
<!-- NOTE (saveTo): img | video | audio | source | track | object | embed | iframe -->

<img
    id="image1"
    src="https://s3-us-west-2.amazonaws.com/s.cdpn.io/12005/harbour1.jpg"
    data-chrome-file="saveTo:../images/harbour::png@(10000,75000)(800x600[bezier]^contain[right|bottom])::compress|base64" /> <!-- "saveTo:~::~::base64" -->
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
- selector: html
  type: html
  filename: index.html
  process:
    - beautify
- selector: .card:nth-of-type(1) img
  type: image
  saveTo: ../images/harbour
  commands:
    - png(10000,75000)(100x200^cover){90,180,270#FFFFFF}
    - jpeg(300x100^contain){90,180,270#FFFFFF}
```

- [bundle.html](https://github.com/anpham6/squared/blob/master/html/chrome/bundle.html)
- [bundle.yml](https://github.com/anpham6/squared/blob/master/html/chrome/bundle.yml)
- [bundle.json](https://github.com/anpham6/squared/blob/master/html/chrome/bundle.json)

```javascript
squared.saveAs('bundle.zip', { configUri: 'http://localhost:3000/chrome/bundle.yml' });
```

Here is the equivalent page with "data-chrome-file" using only inline commands.

- [bundle_inline.html](https://github.com/anpham6/squared/blob/master/html/chrome/bundle_inline.html)

### LICENSE

MIT