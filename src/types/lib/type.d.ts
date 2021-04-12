type Undef<T> = T | undefined;
type Null<T> = T | null;
type Void<T> = T | void;
type Optional<T> = Undef<T> | Null<T>;
type Constructor<T> = new(...args: any[]) => T;
type FunctionType<T, U = unknown> = (...args: U[]) => T;

type NumString = number | string;
type StringOfArray = string | string[];

type StandardMap = Record<string, any>;
type PlainObject = Record<string | number | symbol, unknown>;
type StringMap = Record<string, Undef<string>>;
type ObjectMap<T> = Record<string, Undef<T>>;

type JsonData = Optional<string | number | boolean | unknown[] | StandardMap>;
type StandardCallback<T = unknown, U = void> = (err: Null<Error>, result: T) => U;

interface Point {
    x: number;
    y: number;
}

interface Dimension {
    width: number;
    height: number;
}