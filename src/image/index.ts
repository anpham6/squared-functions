import path = require('path');
import jimp = require('jimp');

import Module from '../module';

export default new class extends Module implements functions.IImage {
    public jpegQuality = 9;

    isJpeg(filename: string, mimeType?: string, filepath?: string) {
        if (mimeType && mimeType.endsWith('image/jpeg')) {
            return true;
        }
        switch (path.extname(filepath || filename).toLowerCase()) {
            case '.jpg':
            case '.jpeg':
                return true;
            default:
                return false;
        }
    }
    parseResizeMode(value: string) {
        const match = /\(\s*(\d+)\s*x\s*(\d+)(?:\s*#\s*(contain|cover|scale))?\s*\)/.exec(value);
        if (match) {
            return { width: parseInt(match[1]), height: parseInt(match[2]), mode: match[3] };
        }
    }
    parseOpacity(value: string) {
        const match = /|\s*([\d.]+)\s*|/.exec(value);
        if (match) {
            const opacity = parseFloat(match[1]);
            if (!isNaN(opacity)) {
                return Math.min(Math.max(opacity, 0), 1);
            }
        }
    }
    parseRotation(value: string) {
        const result = new Set<number>();
        const match = /\{\s*([\d\s,]+)\s*\}/.exec(value);
        if (match) {
            for (const segment of match[1].split(',')) {
                const angle = parseInt(segment);
                if (!isNaN(angle)) {
                    result.add(angle);
                }
            }
        }
        if (result.size) {
            return Array.from(result);
        }
    }
    resize(self: jimp, width: number, height: number, mode?: string) {
        switch (mode) {
            case 'contain':
                return self.contain(width, height);
            case 'cover':
                return self.cover(width, height);
            case 'scale':
                return self.scaleToFit(width, height);
            default:
                return self.resize(width, height);
        }
    }
    rotate(self: jimp, filepath: string, values: number[], manager: functions.IFileManager) {
        const deg = values[0];
        for (let i = 1, length = values.length; i < length; ++i) {
            const value = values[i];
            manager.performAsyncTask();
            const img = self.clone().rotate(value);
            const index = filepath.lastIndexOf('.');
            const output = filepath.substring(0, index) + '.' + value + filepath.substring(index);
            img.write(output, err => {
                if (err) {
                    manager.completeAsyncTask();
                    this.writeFail(output, err);
                }
                else {
                    manager.completeAsyncTask(output);
                }
            });
        }
        return deg ? self.rotate(deg) : self;
    }
    opacity(self: jimp, value: Undef<number>) {
        return value !== undefined && value >= 0 && value <= 1 ? self.opacity(value) : self;
    }
}();