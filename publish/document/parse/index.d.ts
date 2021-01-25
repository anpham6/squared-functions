import type { DomWriterConstructor, HtmlElementConstructor } from './document';

declare namespace Parse {
    const DomWriter: DomWriterConstructor;
    const HtmlElement: HtmlElementConstructor;
}

export = Parse;