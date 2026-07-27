import { Router, Request, Response } from 'express';
import { Op } from 'sequelize';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Post, Comment, BoardConfig } from '../models';
import { checkLevel } from '../middlewares/authMiddleware';
const router = Router();

// ==========================================
// 📁 Multer 파일 업로드 설정
// ==========================================
// 업로드 폴더가 없으면 자동 생성
const uploadDir = path.join(process.cwd(), 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // 한글 파일명 깨짐 방지
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// 파일 확장자 필터링 (exe, apk 차단)
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.exe' || ext === '.apk') {
    return cb(new Error('보안상 실행 파일(.exe, .apk)은 업로드할 수 없습니다.'));
  }
  cb(null, true);
};

export const upload = multer({ 
  storage, 
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB 용량 제한 (필요에 따라 수정)
});


// ==========================================
// 공통 함수: 파라미터로 게시판 설정 찾기
// ==========================================
const findBoardConfig = async (param: string) => {
  return await BoardConfig.findOne({
    where: {
      [Op.or]: [
        { tableName: param }, // 영문 게시판 아이디 매칭[cite: 8]
        ...(isNaN(Number(param)) ? [] : [{ id: Number(param) }]) 
      ]
    }
  });
};

// ==========================================
// 1. 게시글 (Post) 라우터
// ==========================================

// 1-1. 게시글 목록 조회
router.get('/:boardId/posts',checkLevel, async (req: Request, res: Response) => {
  try {
    const boardIdParam = req.params.boardId as string; 
    const boardConfig = await findBoardConfig(boardIdParam);
    if (!boardConfig) return res.status(404).json({ success: false, message: '게시판 없음' });
  
    if (!boardConfig) {
      return res.status(404).json({ success: false, message: '게시판 설정을 찾을 수 없습니다.' });
    }
    if (req.user.level < boardConfig.getDataValue('readLevel')) {
      return res.status(403).json({ success: false, message: '이 게시판의 목록을 볼 수 있는 권한이 없습니다.' });
    }
    
    const configId = boardConfig.get('id') as number; 
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    const posts = await Post.findAndCountAll({
      where: { boardConfigId: configId }, 
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    res.status(200).json({ 
      success: true, 
      data: posts.rows, 
      totalCount: posts.count,
      totalPages: Math.ceil(posts.count / limit),
      currentPage: page 
    });
  } catch (error) {
    console.error('게시글 목록 조회 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

// 1-2. 게시글 작성 (💡 파일 업로드 미들웨어 추가)
router.post('/:boardId/posts', checkLevel, upload.array('attachments'), async (req: Request, res: Response) => {
  try {
    const boardIdParam = req.params.boardId as string;
    const boardConfig = await findBoardConfig(boardIdParam);
    
    if (!boardConfig) {
      return res.status(404).json({ success: false, message: '게시판 설정을 찾을 수 없습니다.' });
    }
    if (req.user.level < boardConfig.getDataValue('writeLevel')) {
      return res.status(403).json({ success: false, message: '이 게시판에 글을 쓸 수 있는 권한이 없습니다.' });
    }

    const configId = boardConfig.get('id') as number;
    const { writerName, title, content, memberId, password, isNotice, extraData } = req.body;

    // 💡 업로드된 파일 정보 파싱
    const files = req.files as Express.Multer.File[];
    let uploadedMediaUrls: string[] = [];
    let thumbnailUrl: string | null = null;

    if (files && files.length > 0) {
      uploadedMediaUrls = files.map(file => `http://localhost:4000/uploads/${file.filename}`);
      
      // 첫 번째 첨부파일이 이미지인 경우 자동으로 썸네일로 지정
      const firstImage = files.find(file => /\.(jpeg|jpg|gif|png|webp)$/i.test(file.originalname));
      if (firstImage) {
        thumbnailUrl = `http://localhost:4000/uploads/${firstImage.filename}`;
      }
    }

    const newPost = await Post.create({
      boardConfigId: configId,
      writerName,
      title,
      content,
      memberId: memberId || null,
      password: password || null,
      isNotice: isNotice === 'true' || isNotice === true, // FormData는 문자열로 전달될 수 있으므로 처리
      extraData: extraData || null,
      mediaUrls: uploadedMediaUrls.length > 0 ? JSON.stringify(uploadedMediaUrls) : null, // DB에는 JSON 문자열로 저장
      thumbnailUrl,
    });

    res.status(201).json({ success: true, data: newPost, message: '게시글이 성공적으로 작성되었습니다.' });
  } catch (error: any) {
    console.error('게시글 작성 오류:', error);
    // Multer 필터 에러 처리 (exe, apk 등)
    if (error.message.includes('보안상')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

// 1-3. 게시글 상세 조회 (조회수 증가 포함)
router.get('/posts/:postId', async (req: Request, res: Response) => {
  try {
    const postId = Number(req.params.postId);
    const post = await Post.findByPk(postId);

    if (!post) {
      return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다.' });
    }

    await post.increment('hitCount', { by: 1 }); 
    await post.reload();

    res.status(200).json({ success: true, data: post });
  } catch (error) {
    console.error('게시글 상세 조회 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

// 1-4. 게시글 수정
router.put('/posts/:postId', upload.array('attachments'), async (req: Request, res: Response) => {
  try {
    const postId = Number(req.params.postId);
    const updateData: any = req.body;

    // 💡 새롭게 첨부된 파일이 있는지 확인하고 처리하는 로직 추가
    const files = req.files as Express.Multer.File[];
    
    if (files && files.length > 0) {
      const uploadedMediaUrls = files.map(file => `http://localhost:4000/uploads/${file.filename}`);
      
      // 첫 번째 첨부 이미지를 썸네일로 지정
      const firstImage = files.find(file => /\.(jpeg|jpg|gif|png|webp)$/i.test(file.originalname));
      
      updateData.mediaUrls = JSON.stringify(uploadedMediaUrls);
      updateData.thumbnailUrl = firstImage ? `http://localhost:4000/uploads/${firstImage.filename}` : null;
    }

    const [updatedRows] = await Post.update(updateData, {
      where: { id: postId }
    });

    if (updatedRows === 0) {
      return res.status(404).json({ success: false, message: '수정할 게시글을 찾을 수 없거나 변경된 내용이 없습니다.' });
    }

    const updatedPost = await Post.findByPk(postId);
    res.status(200).json({ success: true, data: updatedPost, message: '게시글이 수정되었습니다.' });
  } catch (error) {
    console.error('게시글 수정 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

// 1-5. 게시글 삭제 (Soft Delete)
router.delete('/posts/:postId', checkLevel, async (req: Request, res: Response) => {
  try {
    const post = await Post.findByPk(req.params.postId as string);
    const postId = Number(req.params.postId);
    
    const deletedRows = await Post.destroy({ where: { id: postId } }); 

    if (deletedRows === 0) {
      return res.status(404).json({ success: false, message: '삭제할 게시글을 찾을 수 없습니다.' });
    }
    const boardConfig = await BoardConfig.findByPk(post?.getDataValue('boardConfigId'));
    const isAuthor = req.user.id && req.user.id === post?.getDataValue('memberId');
    const hasDeleteLevel = req.user.level >= boardConfig?.getDataValue('deleteLevel');
    const isAdmin = req.user.level === 10;

    if (!isAuthor && !hasDeleteLevel && !isAdmin) {
      return res.status(403).json({ success: false, message: '이 게시글을 삭제할 권한이 없습니다.' });
    }
    res.status(200).json({ success: true, message: '게시글이 삭제되었습니다.' });
  } catch (error) {
    console.error('게시글 삭제 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});


// ==========================================
// 2. 댓글 (Comment) 라우터
// ==========================================

// 2-1. 특정 게시글의 댓글 목록 조회
router.get('/posts/:postId/comments', async (req: Request, res: Response) => {
  try {
    const postId = Number(req.params.postId);

    const comments = await Comment.findAll({
      where: { postId }, 
      order: [['createdAt', 'ASC']]
    });

    res.status(200).json({ success: true, data: comments });
  } catch (error) {
    console.error('댓글 목록 조회 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

// 2-2. 댓글 쓰기
router.post('/posts/:postId/comments', async (req: Request, res: Response) => {
  try {
    const postId = Number(req.params.postId);
    const { writerName, content, memberId, password, parentId } = req.body;

    const post = await Post.findByPk(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: '게시글을 찾을 수 없습니다.' });
    }

    const newComment = await Comment.create({
      postId,
      writerName,
      content,
      memberId: memberId || null,
      password: password || null,
      parentId: parentId || null, 
    });

    res.status(201).json({ success: true, data: newComment, message: '댓글이 성공적으로 등록되었습니다.' });
  } catch (error) {
    console.error('댓글 작성 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

// 2-3. 댓글 수정
router.put('/comments/:commentId', async (req: Request, res: Response) => {
  try {
    const commentId = Number(req.params.commentId);
    const { content } = req.body; 

    const [updatedRows] = await Comment.update({ content }, {
      where: { id: commentId }
    });

    if (updatedRows === 0) {
      return res.status(404).json({ success: false, message: '수정할 댓글을 찾을 수 없습니다.' });
    }

    const updatedComment = await Comment.findByPk(commentId);
    res.status(200).json({ success: true, data: updatedComment, message: '댓글이 수정되었습니다.' });
  } catch (error) {
    console.error('댓글 수정 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

// 2-4. 댓글 삭제 (Soft Delete)
router.delete('/comments/:commentId', async (req: Request, res: Response) => {
  try {
    const commentId = Number(req.params.commentId);
    
    const deletedRows = await Comment.destroy({ where: { id: commentId } });

    if (deletedRows === 0) {
      return res.status(404).json({ success: false, message: '삭제할 댓글을 찾을 수 없습니다.' });
    }

    res.status(200).json({ success: true, message: '댓글이 삭제되었습니다.' });
  } catch (error) {
    console.error('댓글 삭제 오류:', error);
    res.status(500).json({ success: false, message: '서버 오류' });
  }
});

export default router;