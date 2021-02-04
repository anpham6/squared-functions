import type { XmlWriterConstructor, XmlElementConstructor } from './document';

declare namespace Parse {
    const XmlWriter: XmlWriterConstructor;
    const XmlElement: XmlElementConstructor;
}

export = Parse;