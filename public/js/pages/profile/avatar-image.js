export const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const AVATAR_MAX_SIZE = 30 * 1024 * 1024; // 30MB 极端兜底，大部分图片会预压缩

/**
 * 文件前端校验
 */
export function validateAvatarFile(file) {
  if (file.size > AVATAR_MAX_SIZE) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    return `图片过大（${sizeMB}MB），请选择小于 30MB 的图片`;
  }
  if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
    return '仅支持 JPG、PNG、GIF、WebP 格式';
  }
  return null;
}

/**
 * 读取 JPEG EXIF Orientation
 */
function getExifOrientation(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const view = new DataView(e.target.result);
      if (view.getUint16(0, false) !== 0xFFD8) return resolve(1);
      const length = view.byteLength;
      let offset = 2;
      while (offset < length) {
        if (view.getUint16(offset, false) !== 0xFFE1) {
          offset += 2 + view.getUint16(offset + 2, false);
          continue;
        }
        offset += 4;
        if (view.getUint32(offset, false) !== 0x45786966) return resolve(1);
        offset += 6;
        const little = view.getUint16(offset, false) === 0x4949;
        const ifdOffset = offset + 2 + view.getUint32(offset + 2, little);
        const tags = view.getUint16(ifdOffset, little);
        let tagOffset = ifdOffset + 2;
        for (let i = 0; i < tags; i++) {
          if (view.getUint16(tagOffset, little) === 0x0112) {
            return resolve(view.getUint16(tagOffset + 8, little));
          }
          tagOffset += 12;
        }
        break;
      }
      resolve(1);
    };
    reader.readAsArrayBuffer(file.slice(0, 65536));
  });
}

/**
 * 第一级压缩：预压缩图片，使最长边 ≤ 2048px，同时修正 EXIF 方向
 * 返回 { url, blob } — url 用于裁剪器预览，blob 用于兜底上传
 */
export async function precompressImage(file) {
  // 先检查是否需要预压缩（小图片直接跳过）
  const needsPrecompress = file.size > 1 * 1024 * 1024; // > 1MB 才预压缩
  const orientation = await getExifOrientation(file);
  const needsRotation = orientation > 1;

  if (!needsPrecompress && !needsRotation) {
    // 小图片且无需旋转：直接使用原文件
    return { url: URL.createObjectURL(file), blob: file, precompressed: false };
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectURL = URL.createObjectURL(file);

    // 10 秒超时保护
    const timeout = setTimeout(() => {
      URL.revokeObjectURL(objectURL);
      // 超时降级：直接使用原图
      resolve({ url: objectURL, blob: file, precompressed: false, timeout: true });
    }, 10000);

    img.onload = () => {
      clearTimeout(timeout);

      try {
        const MAX_EDGE = 2048;
        let { width, height } = img;

        // 等比缩放使最长边 ≤ MAX_EDGE
        if (width > MAX_EDGE || height > MAX_EDGE) {
          const ratio = Math.min(MAX_EDGE / width, MAX_EDGE / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // iOS Safari canvas 像素限制兼容
        const totalPixels = width * height;
        if (totalPixels > 268435456) { // ~268MP, iOS Safari 硬限制
          const scaleRatio = Math.sqrt(268435456 / totalPixels);
          width = Math.round(width * scaleRatio);
          height = Math.round(height * scaleRatio);
          canvas.width = width;
          canvas.height = height;
        }

        // 处理 EXIF 旋转
        ctx.save();
        switch (orientation) {
          case 2: ctx.transform(-1, 0, 0, 1, width, 0); break;
          case 3: ctx.transform(-1, 0, 0, -1, width, height); break;
          case 4: ctx.transform(1, 0, 0, -1, 0, height); break;
          case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
          case 6: ctx.transform(0, 1, -1, 0, height, 0); break;
          case 7: ctx.transform(0, -1, -1, 0, height, width); break;
          case 8: ctx.transform(0, -1, 1, 0, 0, width); break;
        }
        ctx.drawImage(img, 0, 0, width, height);
        ctx.restore();

        URL.revokeObjectURL(objectURL);

        canvas.toBlob((blob) => {
          if (!blob) {
            // 降级：使用原图
            resolve({ url: URL.createObjectURL(file), blob: file, precompressed: false });
            return;
          }
          const url = URL.createObjectURL(blob);
          resolve({ url, blob, precompressed: true });
        }, 'image/jpeg', 0.9);
      } catch (err) {
        URL.revokeObjectURL(objectURL);
        // 降级：使用原图
        resolve({ url: URL.createObjectURL(file), blob: file, precompressed: false });
        console.warn('预压缩失败，使用原图:', err);
      }
    };

    img.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(objectURL);
      reject(new Error('图片无法读取，请换一张重试'));
    };

    img.src = objectURL;
  });
}

/**
 * 第三级压缩：自动质量降级，确保 blob ≤ 2MB
 * @param {HTMLCanvasElement} canvas
 * @param {number} targetBytes
 * @returns {Promise<Blob>}
 */
export function compressToTargetSize(canvas, targetBytes = 2 * 1024 * 1024) {
  return new Promise((resolve) => {
    let quality = 0.9;
    const minQuality = 0.3;

    function tryCompress(q) {
      canvas.toBlob((blob) => {
        if (!blob) {
          // 失败降级：最低质量
          if (q > minQuality) { tryCompress(q - 0.1); return; }
          canvas.toBlob((b) => resolve(b), 'image/jpeg', minQuality);
          return;
        }
        if (blob.size <= targetBytes || q <= minQuality) {
          resolve(blob);
        } else {
          tryCompress(Math.max(minQuality, q - 0.1));
        }
      }, 'image/jpeg', q);
    }

    tryCompress(quality);
  });
}
