import type { JimpImageConstructor } from './image';

import type * as jimp from 'jimp';

declare const JimpImage: JimpImageConstructor<jimp>;

export = JimpImage;