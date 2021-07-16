interface SystemError extends Error {
    address: string;
    code: string;
    dest: string;
    errno: number;
    info: PlainObject;
    message: string;
    path: string;
    port: number;
    syscall: string;
}