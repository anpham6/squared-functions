type Undef<T> = T | undefined;
type Null<T> = T | null;
type Void<T> = T | void;
type Optional<T> = Undef<T> | Null<T>;
type Nullable<T> = { [P in keyof T]: T[P] | null; };
type KeyOfType<T, U = any, V = any> = { [K in keyof T]: K extends U ? T[K] extends V ? K : never : never }[keyof T];
type MapOfType<T, U = any, V = any> = { [K in KeyOfType<T, U, V>]: K extends U ? T[K] extends V ? T[K] : never : never };

type Constructor<T> = new(...args: any[]) => T;

type FunctionType<T = unknown, U = unknown> = (...args: U[]) => T;

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