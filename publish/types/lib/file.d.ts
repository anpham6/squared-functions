interface FileAsset {
    pathname: string;
    filename: string;
    content?: string;
    uri?: string;
    mimeType?: string;
    base64?: string;
    compress?: CompressFormat[];
}

interface ChromeAsset {
    rootDir?: string;
    moveTo?: string;
    format?: string;
    requestMain?: boolean;
    bundleIndex?: number;
    preserve?: boolean;
    trailingContent?: FormattableContent[];
    outerHTML?: string;
}

interface Exclusions {
    pathname?: string[];
    filename?: string[];
    extension?: string[];
    pattern?: string[];
}

interface CompressFormat {
    format: string;
    level?: number;
    condition?: string;
}

interface FormattableContent {
    value: string;
    format?: string;
    preserve?: boolean;
}

interface ResultOfFileAction {
    success: boolean;
    zipname?: string;
    bytes?: number;
    files?: string[];
    application?: string;
    system?: string;
}