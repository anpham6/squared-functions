type Undef<T> = T | undefined;
type Null<T> = T | null;
type Void<T> = T | void;
type Constructor<T> = new(...args: any[]) => T;
type FunctionType<T, U = unknown> = (...args: U[]) => T;

type NumString = number | string;

type StandardMap = Record<string, any>;
type PlainObject = Record<string | number | symbol, unknown>;
type StringMap = Record<string, Undef<string>>;

type ObjectMap<T> = Record<string, T>;

interface Point {
    x: number;
    y: number;
}

interface Dimension {
    width: number;
    height: number;
}