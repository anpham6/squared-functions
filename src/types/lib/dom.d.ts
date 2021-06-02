interface BoxRect<T = number> {
    top: T;
    right: T;
    bottom: T;
    left: T;
}

interface BoxRectDimension extends BoxRect, Dimension {
    numberOfLines?: number;
    overflow?: boolean;
}

type CssStyleMap = Partial<MapOfType<CSSStyleDeclaration, CssStyleAttr, string>>;
type CssStyleAttr = KeyOfType<CSSStyleDeclaration, string, string>;