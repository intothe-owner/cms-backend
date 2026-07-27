import multer from 'multer';
import path from 'path';
import fs from 'fs';

// 파일을 저장할 실제 디렉토리 경로 (프로젝트 루트의 public/uploads)
const uploadDir = path.join(process.cwd(), 'public', 'uploads');

// 폴더가 없으면 자동으로 생성
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 스토리지 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir); // 지정한 폴더에 저장
  },
  filename: (req, file, cb) => {
    // 한글 파일명 깨짐 방지 및 중복 방지를 위해 타임스탬프와 난수 추가
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

// 이미지, 동영상, 오디오 파일 모두 허용하는 필터
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (
    file.mimetype.startsWith('image/') || 
    file.mimetype.startsWith('video/') ||
    file.mimetype.startsWith('audio/')
  ) {
    cb(null, true);
  } else {
    cb(new Error('이미지, 동영상, 오디오 파일만 업로드 가능합니다.'));
  }
};

export const upload = multer({ 
  storage,
  fileFilter,
  // 동영상 업로드를 고려하여 용량 제한을 50MB(52,428,800 바이트)로 증량
  // 서비스 정책에 따라 100MB(100 * 1024 * 1024) 등으로 조절해서 사용하세요.
  limits: { fileSize: 50 * 1024 * 1024 } 
});