const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const querystring = require('querystring');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = 3000;

// 配置中间件
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use(session({
    secret: 'nufe-grade-calculator',
    resave: false,
    saveUninitialized: true
}));

// 南京财经大学教务系统配置
const NUFE_CONFIG = {
    authBaseUrl: 'https://authserver.nufe.edu.cn/authserver',
    loginUrl: 'https://authserver.nufe.edu.cn/authserver/login',
    ehallBaseUrl: 'http://ehall.nufe.edu.cn',
    gradeUrl: 'http://ehall.nufe.edu.cn/jwapp/sys/cjcx/modules/cjcx/xscjcx.do'
};

// 登录并获取成绩
app.post('/api/login', async (req, res) => {
    const { schoolId, password } = req.body;
    
    if (!schoolId || !password) {
        return res.json({ success: false, message: '学号和密码不能为空' });
    }
    
    try {
        // 步骤1：获取登录页面，提取必要参数
        const loginPageRes = await axios.get(NUFE_CONFIG.loginUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            },
            withCredentials: true
        });
        
        // 保存Cookie
        req.session.cookies = loginPageRes.headers['set-cookie'];
        
        // 解析登录页面，获取LT和execution参数
        const $ = cheerio.load(loginPageRes.data);
        const lt = $('input[name="lt"]').val();
        const execution = $('input[name="execution"]').val();
        
        // 步骤2：构造登录表单数据
        const loginData = querystring.stringify({
            username: schoolId,
            password: password,
            lt: lt,
            execution: execution,
            _eventId: 'submit',
            submit: '登录'
        });
        
        // 步骤3：发送登录请求
        const loginRes = await axios.post(NUFE_CONFIG.loginUrl, loginData, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': req.session.cookies?.join('; ') || ''
            },
            maxRedirects: 0,  // 阻止自动重定向，手动处理
            validateStatus: (status) => status === 302 || status === 200,
            withCredentials: true
        });
        
        // 更新Cookie
        if (loginRes.headers['set-cookie']) {
            req.session.cookies = loginRes.headers['set-cookie'];
        }
        
        // 步骤4：检查是否登录成功
        if (loginRes.status === 302 && loginRes.headers.location) {
            // 获取重定向URL（可能包含ST票据）
            const redirectUrl = loginRes.headers.location;
            
            // 步骤5：访问ehall首页，完成认证
            const ehallRes = await axios.get(redirectUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Cookie': req.session.cookies?.join('; ') || ''
                },
                withCredentials: true
            });
            
            // 更新Cookie
            if (ehallRes.headers['set-cookie']) {
                req.session.cookies = ehallRes.headers['set-cookie'];
            }
            
            // 步骤6：获取成绩数据
            const gradeRes = await axios.get(NUFE_CONFIG.gradeUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Cookie': req.session.cookies?.join('; ') || ''
                },
                withCredentials: true
            });
            
            // 步骤7：解析成绩数据
            const $ = cheerio.load(gradeRes.data);
            const grades = [];
            
            // 提取学生姓名（如果有）
            const userName = $('span.username').text().trim() || '同学';
            
            // 解析成绩表格（需要根据实际页面结构调整）
            $('table.datagrid-body tr').each((index, row) => {
                const $row = $(row);
                const courseName = $row.find('td:nth-child(3)').text().trim();  // 第3列是课程名
                const credit = $row.find('td:nth-child(4)').text().trim();      // 第4列是学分
                const score = $row.find('td:nth-child(5)').text().trim();       // 第5列是成绩
                
                // 转换百分制成绩为绩点（南京财经大学标准）
                let gradePoint = 0;
                if (!isNaN(parseFloat(score))) {
                    const scoreNum = parseFloat(score);
                    if (scoreNum >= 90) gradePoint = 4.0;
                    else if (scoreNum >= 85) gradePoint = 3.7;
                    else if (scoreNum >= 80) gradePoint = 3.3;
                    else if (scoreNum >= 75) gradePoint = 3.0;
                    else if (scoreNum >= 70) gradePoint = 2.7;
                    else if (scoreNum >= 65) gradePoint = 2.3;
                    else if (scoreNum >= 60) gradePoint = 1.0;
                }
                
                if (courseName && credit && score) {
                    grades.push({ name: courseName, credit, grade: gradePoint, score });
                }
            });
            
            res.json({ success: true, grades, userName });
        } else {
            // 登录失败
            res.json({ success: false, message: '登录失败，请检查学号和密码' });
        }
    } catch (error) {
        console.error('登录或获取成绩失败:', error);
        res.json({ success: false, message: '服务器错误，请重试' });
    }
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
    console.log(`访问 http://localhost:${PORT} 使用绩点计算器`);
});
