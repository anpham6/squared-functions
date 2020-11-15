type Undef<T> = T | undefined;
type Null<T> = T | null;
type Void<T> = T | void;

type Constructor<T> = new(...args: any[]) => T;
type FunctionType<T> = (...args: any[]) => T;

type NumString = number | string;
type ObjectString = PlainObject | string;

type StringMap = Record<string, Undef<string>>;
type StandardMap = Record<string, any>;
type PlainObject = Record<string | number | symbol, unknown>;
type ObjectMap<T> = Record<string, T>;

interface Point {
    x: number;
    y: number;
}

interface Dimension {
    width: number;
    height: number;
}