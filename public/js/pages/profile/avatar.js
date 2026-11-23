import { getToken } from '../../core/api.js';
import { closeModal, escHtml, openModal, showBottomSheet, showToast } from '../../components/ui.js';
import { AVATAR_ALLOWED_TYPES, compressToTargetSize, precompressImage, validateAvatarFile } from './avatar-image.js';

/**
 * 点击头像 → 弹出底部动作菜单
 */
function openAvatarSheet() {
  // 检测是否有真实摄像头（桌面端即使 DevTools 模拟手机，也没有摄像头）
  const hasCamera = !!navigator.mediaDevices?.getUserMedia;
  const hasAvatar = !!window._currentUser?.avatar_url;

  const items = [
    {
      icon: 'image',
      label: '从相册选择',
      onClick: () => pickImageFile(false)
    }
  ];

  // 仅有真实摄像头的设备才显示拍照上传
  if (hasCamera) {
    items.push({
      icon: 'camera_alt',
      label: '拍照上传',
      onClick: () => pickImageFile(true)
    });
  }

  // 仅当前有自定义头像时才显示恢复默认
  if (hasAvatar) {
    items.push({
      icon: 'refresh',
      label: '恢复默认头像',
      onClick: resetToDefaultAvatar
    });
  }

  items.push({ label: '取消', isCancel: true });

  showBottomSheet(items);
}

/**
 * 打开文件选择器（相册或拍照）
 */
function pickImageFile(capture) {
  const input = document.createElement('input');
  input.type = 'file';
  // 拍照模式：accept="image/*" 配合 capture 属性，强制调用摄像头
  input.accept = capture ? 'image/*' : AVATAR_ALLOWED_TYPES.join(',');
  if (capture) {
    input.setAttribute('capture', 'environment');
  }
  input.style.display = 'none';

  input.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 前端文件校验（30MB 极端兜底）
    const error = validateAvatarFile(file);
    if (error) {
      showToast(error);
      return;
    }

    // 第一级：预压缩（> 1MB 或需 EXIF 修正时触发）
    let imageUrl;
    if (file.size > 1 * 1024 * 1024) {
      showToast('正在自动压缩图片，请稍候...');
    }
    try {
      const compressed = await precompressImage(file);
      imageUrl = compressed.url;
      // 保存预压缩引用（存入闭包变量，不上字符串属性）
      window._avatarPrecompressed = { blob: compressed.blob, precompressed: compressed.precompressed };
    } catch (err) {
      showToast(err.message || '图片处理失败');
      return;
    }

    showAvatarCropper(imageUrl);
  });

  document.body.appendChild(input);
  input.click();

  // 清理
  setTimeout(() => input.remove(), 500);

  // 检测摄像头权限被拒（仅拍照模式）
  if (capture) {
    setTimeout(async () => {
      if (input.files?.length || document.querySelector('.cropper-fullscreen')) return;
      try {
        const status = await navigator.permissions.query({ name: 'camera' });
        if (status.state === 'denied') {
          showToast('需要相机权限才能拍照上传');
        }
      } catch { /* 不支持 permissions API */ }
    }, 1500);
  }
}

/**
 * 打开裁剪界面
 */
async function showAvatarCropper(imageUrl) {
  // imageUrl 已是预压缩后的 URL（含 EXIF 修正），直接用于裁剪器
  const objectURL = imageUrl;

  const overlay = document.createElement('div');
  overlay.className = 'cropper-fullscreen';
  overlay.id = 'cropper-overlay';
  overlay.innerHTML = `
    <div class="cropper-wrapper">
      <div class="cropper-header">
        <button class="cropper-btn-text" id="cropper-cancel">取消</button>
        <span class="cropper-title">裁剪头像</span>
        <button class="cropper-btn-fill" id="cropper-save">保存</button>
      </div>
      <div class="cropper-area">
        <img id="cropper-image" src="${objectURL}" alt="">
      </div>
      <div class="cropper-footer">
        <button class="cropper-btn-icon" id="cropper-rotate" title="旋转">
          <span class="mi">rotate_right</span>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // 初始化 Cropper（v1.6.2，构造函数直接在 window.Cropper）
  const imageEl = overlay.querySelector('#cropper-image');
  const cropper = new Cropper(imageEl, {
    aspectRatio: 1,
    viewMode: 1,            // 禁止图片拖出裁剪框
    dragMode: 'move',       // 拖动图片而非裁剪框
    autoCropArea: 1,        // 裁剪框初始占满图片
    minCanvasWidth: 300,    // 强制图片最小宽度
    minCanvasHeight: 300,   // 强制图片最小高度
    minCropBoxWidth: 192,   // 裁剪框最小尺寸
    cropBoxMovable: false,  // 禁止移动裁剪框
    cropBoxResizable: false,// 禁止调整裁剪框大小
    guides: true,           // 九宫格辅助线
    background: false,
    modal: true,            // 裁剪框外半透明遮罩
    rotatable: true,
    scalable: true,
    zoomable: true,
    zoomOnWheel: true,
    responsive: true,
    restore: false
  });

  // 保存按钮
  const saveBtn = overlay.querySelector('#cropper-save');
  const cancelBtn = overlay.querySelector('#cropper-cancel');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    saveBtn.innerHTML = '<span class="md-spinner" style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;display:inline-block"></span> 处理中...';

    try {
      const canvas = cropper.getCroppedCanvas({ width: 384, height: 384 });
      const result = await uploadCroppedAvatar(canvas, (progress) => {
        saveBtn.innerHTML = `<span class="md-spinner" style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;display:inline-block"></span> ${progress}%`;
      });

      // 成功
      if (window._currentUser) {
        window._currentUser.avatar_url = result.avatar_url;
      }
      showToast('头像更新成功');

      // 关闭裁剪界面
      closeCropper(overlay, cropper, objectURL);

      // 更新页面上的头像
      updateProfileAvatarDisplay(result.avatar_url);
    } catch (err) {
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      saveBtn.textContent = '保存';
      showToast(err.message || '上传失败，请检查网络后重试');
    }
  });

  // 取消按钮
  overlay.querySelector('#cropper-cancel').addEventListener('click', () => {
    closeCropper(overlay, cropper, objectURL);
  });

  // Escape 关闭
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeCropper(overlay, cropper, objectURL);
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // 旋转按钮
  overlay.querySelector('#cropper-rotate').addEventListener('click', () => {
    cropper.rotate(90);
  });
}

function closeCropper(overlay, cropper, objectURL) {
  if (cropper) cropper.destroy();
  if (objectURL) URL.revokeObjectURL(objectURL);
  if (overlay) overlay.remove();
}

/**
 * 上传裁剪后的头像（第二级标准化 + 第三级降级 + XHR 进度）
 * @param {HTMLCanvasElement} canvas
 * @param {Function} onProgress — (percent: number) => void
 */
async function uploadCroppedAvatar(canvas, onProgress) {
  return new Promise((resolve, reject) => {
    // 第二级：标准化输出 384×384 JPEG q=0.92
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error('图片处理失败'));
        return;
      }

      // 第三级：自动质量降级，确保 ≤ 2MB
      let finalBlob = blob;
      if (blob.size > 2 * 1024 * 1024) {
        finalBlob = await compressToTargetSize(canvas);
      }

      // 极端情况：即使最低质量仍 > 2MB
      if (finalBlob.size > 2 * 1024 * 1024) {
        reject(new Error('图片过大，请选择更小的图片'));
        return;
      }

      const formData = new FormData();
      formData.append('avatar', finalBlob, 'avatar.jpg');

      const token = getToken();
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const pct = Math.round((e.loaded / e.total) * 100);
          onProgress(pct);
        }
      });

      xhr.addEventListener('load', () => {
        try {
          const result = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300 && !result.error) {
            resolve(result);
          } else {
            reject(new Error(result.error || '上传失败'));
          }
        } catch {
          reject(new Error('上传失败，请检查网络后重试'));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('上传失败，请检查网络后重试'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('上传已取消'));
      });

      xhr.open('POST', '/api/auth/avatar');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    }, 'image/jpeg', 0.92);
  });
}

/**
 * 恢复默认头像
 */
async function resetToDefaultAvatar() {
  openModal('恢复默认头像', `
    <p class="text-secondary">确定要恢复为系统默认头像吗？此操作不可撤销。</p>
    <div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-4)">
      <button class="btn btn-secondary" id="reset-avatar-cancel-btn">取消</button>
      <button class="btn btn-primary" id="reset-avatar-confirm-btn">确定</button>
    </div>
  `);

  document.getElementById('reset-avatar-cancel-btn')?.addEventListener('click', closeModal);
  document.getElementById('reset-avatar-confirm-btn')?.addEventListener('click', async () => {
    closeModal();
    try {
      const token = getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/auth/me', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ avatar_url: '' })
      });
      const result = await res.json();

      if (result.error) {
        showToast(result.error);
        return;
      }

      if (window._currentUser) {
        window._currentUser.avatar_url = '';
      }
      showToast('已恢复默认头像');
      updateProfileAvatarDisplay('');
    } catch {
      showToast('操作失败，请重试');
    }
  });
}

/**
 * 局部更新页面上的头像显示（不刷新整页）
 */
function updateProfileAvatarDisplay(avatarUrl) {
  const container = document.querySelector('#profile-avatar-area');
  if (!container) return;

  if (avatarUrl) {
    container.innerHTML = `
      <img class="profile-avatar-img" src="${escHtml(avatarUrl)}" alt="">
      <span class="profile-avatar-overlay"><span class="mi" style="font-size:20px;color:#fff">photo_camera</span></span>
    `;
  } else {
    const user = window._currentUser;
    const initial = (user?.nickname || user?.username || '?')[0];
    container.innerHTML = `
      <span class="profile-avatar-letter">${escHtml(initial)}</span>
      <span class="profile-avatar-overlay"><span class="mi" style="font-size:20px;color:#fff">photo_camera</span></span>
    `;
  }
}

// 绑定头像点击事件需要在页面渲染后执行
export function bindAvatarClick() {
  const avatarArea = document.getElementById('profile-avatar-area');
  if (avatarArea && !avatarArea.dataset.bound) {
    avatarArea.dataset.bound = '1';
    avatarArea.addEventListener('click', openAvatarSheet);
  }
}

// 挂载到 window（旧兼容）
window._handleAvatarUpload = function(event) {
  // 已废弃，保留以兼容旧代码
  const file = event.target.files?.[0];
  if (!file) return;
  const error = validateAvatarFile(file);
  if (error) { showToast(error); return; }
  showAvatarCropper(file);
};
