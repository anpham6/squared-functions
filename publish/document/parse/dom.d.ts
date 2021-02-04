import type { DomWriterConstructor, XmlElementConstructor } from './document';

declare namespace DomParse {
    const DomWriter: DomWriterConstructor;
    const HtmlElement: XmlElementConstructor;
}

export = DomParse;