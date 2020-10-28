type Undef<T> = T | undefined;
type Null<T> = T | null;
type Void<T> = T | void;

type FunctionType<T> = (...args: any[]) => T;

type NumString = number | string;

type StringMap = Record<string, Undef<string>>;
type StandardMap = Record<string, any>;
type ObjectMap<T> = Record<string, T>;

interface Point {
    x: number;
    y: number;
}

interface Dimension {
    width: number;
    height: number;
}