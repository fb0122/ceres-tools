import React, { useEffect, useState } from 'react';
import { List, Button, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';

const fs = window.require ? window.require('fs') : null;
const path = window.require ? window.require('path') : null;
const electron = window.require ? window.require('electron') : null;

export default function DateList() {
  const [dates, setDates] = useState([]);
  const [dataByDate, setDataByDate] = useState({});
  const [userDataPath, setUserDataPath] = useState('');
  const [dataFile, setDataFile] = useState('');
  const [industryCodeMap, setIndustryCodeMap] = useState({}); // 行业编号映射
  const [codeMapFile, setCodeMapFile] = useState(''); // 编号映射文件路径
  const navigate = useNavigate();

  useEffect(() => {
    if (electron && electron.ipcRenderer) {
      electron.ipcRenderer.invoke('get-user-data-path').then((p) => {
        setUserDataPath(p);
        setDataFile(path ? path.join(p, 'data.json') : '');
        setCodeMapFile(path ? path.join(p, 'industry_codes.json') : '');
        
        if (fs && path) {
          // 加载数据文件
          const filePath = path.join(p, 'data.json');
          if (fs.existsSync(filePath)) {
            try {
              const raw = fs.readFileSync(filePath, 'utf-8');
              const local = JSON.parse(raw);
              setDataByDate(local);
              setDates(Object.keys(local));
              console.log('初始化加载 - 日期列表:', Object.keys(local));
            } catch {
              setDataByDate({});
              setDates([]);
            }
          }
          
          // 加载行业编号映射文件
          const codeMapPath = path.join(p, 'industry_codes.json');
          if (fs.existsSync(codeMapPath)) {
            try {
              const raw = fs.readFileSync(codeMapPath, 'utf-8');
              const codes = JSON.parse(raw);
              setIndustryCodeMap(codes);
              console.log('初始化加载 - 行业编号映射:', codes);
            } catch {
              setIndustryCodeMap({});
            }
          }
        }
      });
    }
  }, []);

  // 监听dataByDate变化，自动更新dates
  useEffect(() => {
    const newDates = Object.keys(dataByDate);
    console.log('dataByDate变化 - 更新日期列表:', newDates);
    setDates(newDates);
  }, [dataByDate]);

  // 批量导出所有日期的聚合数据
  const handleBatchExport = async () => {
    if (!dates.length) return message.warning('无数据可导出');
    if (!(electron && electron.ipcRenderer)) {
      return message.error('当前环境不支持批量导出');
    }
    // 选择导出目录（通过主进程）
    const result = await electron.ipcRenderer.invoke('select-export-folder');
    if (!result || result.canceled || !result.filePaths || !result.filePaths[0]) return;
    const exportDir = result.filePaths[0];
    let exportedCount = 0;
    dates.forEach(date => {
      const rows = dataByDate[date] || [];
      if (!rows.length) return;
      // 按行业聚合
      const industryMap = {};
      rows.forEach(row => {
        const { industry, amount, code } = row;
        if (!industryMap[industry]) {
          // 优先使用行中的编号，然后尝试从映射中获取
          const cleanIndustry = industry.trim();
          const finalCode = code || industryCodeMap[industry] || industryCodeMap[cleanIndustry] || '';
          industryMap[industry] = { industry, code: finalCode, count: 0, total: 0 };
        }
        industryMap[industry].count += 1;
        industryMap[industry].total += amount;
      });
      const result = Object.values(industryMap).map(item => ({
        ...item,
        total: item.total.toFixed(2),
        date: date,
      }));
      // 导出
      const exportData = result.map(row => ({
        '行业编号': row.code,  // 使用聚合后的编号
        '行业': row.industry,
        '股票数量': row.count,
        '成交总额（亿）': row.total,
        '日期': row.date,
      }));
      
      // 创建工作表并设置列格式
      const ws = XLSX.utils.json_to_sheet(exportData);
      
      // 设置列格式：数字列保持数字格式，文本列保持文本格式
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let col = range.s.c; col <= range.e.c; col++) {
        const colLetter = XLSX.utils.encode_col(col);
        const headerCell = ws[colLetter + '1'];
        if (headerCell) {
          const headerValue = headerCell.v;
          // 为数字列设置数字格式
          if (headerValue === '行业编号' || headerValue === '股票数量' || headerValue === '成交总额（亿）') {
            for (let row = range.s.r + 1; row <= range.e.r; row++) {
              const cellAddress = colLetter + (row + 1);
              const cell = ws[cellAddress];
              if (cell) {
                // 确保数字列的值是数字类型
                if (headerValue === '行业编号' || headerValue === '股票数量') {
                  const numValue = parseFloat(cell.v);
                  if (!isNaN(numValue)) {
                    cell.t = 'n'; // 数字类型
                    cell.v = numValue;
                  }
                } else if (headerValue === '成交总额（亿）') {
                  const numValue = parseFloat(cell.v);
                  if (!isNaN(numValue)) {
                    cell.t = 'n'; // 数字类型
                    cell.v = numValue;
                    cell.z = '#,##0.00'; // 数字格式：保留两位小数
                  }
                }
              }
            }
          }
        }
      }
      
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, date);
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      if (fs && path && exportDir) {
        const filePath = path.join(exportDir, `${date}.xlsx`);
        fs.writeFileSync(filePath, Buffer.from(buf));
        exportedCount++;
      }
    });
    if (exportedCount > 0) {
      message.success(`批量导出完成，共导出${exportedCount}个文件`);
    } else {
      message.info('没有可导出的数据');
    }
  };

  // 处理文件上传
  const handleUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      message.error('仅支持 Excel/CSV 文件');
      return;
    }
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(worksheet);
      // 解析日期
      let dateFromHeader = '';
      if (sheetName && /\d{4}-?\d{0,2}-?\d{0,2}/.test(sheetName)) {
        dateFromHeader = sheetName.replace(/[^\d-]/g, '');
      }
      // 处理数据 - 如果是同一日期则覆盖，否则合并
      const newDataByDate = { ...dataByDate };
      
      // 检查是否上传的是已存在的日期
      if (dateFromHeader && newDataByDate[dateFromHeader]) {
        console.log(`检测到上传日期 ${dateFromHeader} 已存在，将覆盖原有数据`);
        // 清空该日期的原有数据
        newDataByDate[dateFromHeader] = [];
      }
      json.forEach(row => {
        if (!row) return;
        const industry = row['所属行业'] || row['行业'] || '未知';
        let date = dateFromHeader || '未知日期';
        
        // 查找金额字段：支持多种可能的字段名
        let amount = '';
        const possibleKeys = Object.keys(row);
        for (const key of possibleKeys) {
          if (key.includes('金额') || key.includes('成交额') || key.includes('成交金额')) {
            amount = row[key];
            console.log('找到金额字段:', key, '值:', amount);
            break;
          }
        }

        // 打印原始数据，帮助排查
        console.log('原始行数据:', row);
        console.log('提取到的金额字段:', amount);

        // 金额解析修正：全部按"亿"为单位
        let parsedAmount = 0;
        
        // 如果金额字段非空，尝试解析
        if (amount && amount.toString().trim() !== '') {
          let str = String(amount).replace(/,/g, '').replace(/\s/g, '').trim();
          
          // 1. 判断单位
          let unit = '元';  // 默认单位为元
          if (str.includes('亿')) unit = '亿';
          else if (str.includes('万')) unit = '万';
          
          // 2. 提取纯数字部分
          let numStr = str.replace(/[^\d.]/g, '');
          let num = parseFloat(numStr);
          
          // 3. 根据单位转换为亿
          if (!isNaN(num)) {
            switch (unit) {
              case '亿':
                parsedAmount = num;
                break;
              case '万':
                parsedAmount = num / 10000;
                break;
              case '元':
                parsedAmount = num / 1e8;
                break;
            }
          }

          // 打印调试信息
          console.log('金额解析过程:', {
            原始金额: amount,
            清理后: str,
            单位: unit,
            数值字符串: numStr,
            解析数值: num,
            转换后亿: parsedAmount
          });
        } else {
          console.log('金额无效或未找到金额字段');
        }

        // 确保日期数组存在
        if (!newDataByDate[date]) newDataByDate[date] = [];
        
        // 去除行业名称前后的空格进行匹配
        const cleanIndustry = industry.trim();
        const code = industryCodeMap[cleanIndustry] || industryCodeMap[industry] || '';
        newDataByDate[date].push({ 
          industry, 
          rawAmount: amount,  // 保存原始金额字符串
          amount: parsedAmount,  // 保存转换后的金额（亿）
          code: code  // 添加行业编号
        });
        
        // 调试信息
        if (code) {
          console.log(`✓ 为行业 "${industry}" 应用编号 "${code}"`);
        } else {
          console.log(`✗ 行业 "${industry}" 没有找到对应编号 (尝试了 "${cleanIndustry}" 和 "${industry}")`);
        }
      });
      // 保存到本地
      if (fs && dataFile) {
        fs.writeFileSync(dataFile, JSON.stringify(newDataByDate, null, 2), 'utf-8');
      }
      
      // 移除有问题的去重逻辑，保持原始数据完整性
      
      // 更新状态
      console.log('上传数据表后 - 新的数据:', newDataByDate);
      
      setDataByDate(newDataByDate);
      message.success('上传并保存成功');
    } catch (err) {
      message.error('文件解析失败');
      console.error('解析文件出错:', err);
    }
  };

  // 处理编号表上传
  const handleCodeUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      message.error('仅支持 Excel/CSV 文件');
      return;
    }

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(worksheet);

      // 解析编号表
      const newCodeMap = {};
      console.log('开始解析编号表...');
      console.log('编号表原始数据:', json);
      
      json.forEach((row, index) => {
        if (!row) return;
        
        console.log(`解析第 ${index + 1} 行:`, row);
        
        // 查找编号和行业字段
        let code = '';
        let industry = '';
        
        const keys = Object.keys(row);
        for (const key of keys) {
          if (key.includes('编号') || key.includes('代码') || key.includes('code')) {
            code = row[key];
            console.log(`找到编号字段 "${key}": ${code}`);
          }
          if (key.includes('行业') || key.includes('industry')) {
            industry = row[key];
            console.log(`找到行业字段 "${key}": ${industry}`);
          }
        }

        if (code && industry) {
          const cleanIndustry = industry.toString().trim();
          const cleanCode = code.toString().trim();
          newCodeMap[cleanIndustry] = cleanCode;
          console.log(`✓ 添加映射: "${cleanIndustry}" -> "${cleanCode}"`);
        } else {
          console.log(`✗ 第 ${index + 1} 行缺少编号或行业信息`);
        }
      });

      if (Object.keys(newCodeMap).length === 0) {
        message.error('未找到有效的编号和行业对应关系');
        return;
      }

      // 保存编号映射
      if (fs && codeMapFile) {
        fs.writeFileSync(codeMapFile, JSON.stringify(newCodeMap, null, 2), 'utf-8');
      }
      setIndustryCodeMap(newCodeMap);

      // 不再自动更新现有数据的行业编号，只保存编号映射
      console.log('编号映射已保存，如需更新现有数据请点击刷新按钮');
      message.success('编号表上传成功，请点击刷新按钮更新所有数据的编号');
      
    } catch (err) {
      message.error('编号表解析失败');
      console.error('解析编号表出错:', err);
    }
  };

  // 清空本地数据
  const handleClearData = () => {
    if (fs && dataFile && codeMapFile) {
      try {
        // 删除数据文件
        if (fs.existsSync(dataFile)) {
          fs.unlinkSync(dataFile);
          console.log('已删除数据文件:', dataFile);
        }
        
        // 删除编号映射文件
        if (fs.existsSync(codeMapFile)) {
          fs.unlinkSync(codeMapFile);
          console.log('已删除编号映射文件:', codeMapFile);
        }
        
        // 清空状态
        setDataByDate({});
        setIndustryCodeMap({});
        
        message.success('本地数据已清空');
      } catch (err) {
        console.error('清空数据失败:', err);
        message.error('清空数据失败');
      }
    } else {
      message.warning('无法访问本地文件系统');
    }
  };

  // 刷新所有数据的行业编号
  const handleRefreshCodes = () => {
    if (!industryCodeMap || Object.keys(industryCodeMap).length === 0) {
      message.warning('请先上传编号表');
      return;
    }

    console.log('开始刷新所有数据的行业编号...');
    console.log('当前编号映射:', industryCodeMap);
    console.log('当前数据:', dataByDate);

    const updatedDataByDate = { ...dataByDate };
    let updatedCount = 0;

    Object.keys(updatedDataByDate).forEach(date => {
      console.log(`处理日期 ${date} 的数据...`);
      updatedDataByDate[date] = updatedDataByDate[date].map(item => {
        const newItem = { ...item };
        const cleanIndustry = item.industry.trim();
        
        if (industryCodeMap[item.industry] || industryCodeMap[cleanIndustry]) {
          const code = industryCodeMap[item.industry] || industryCodeMap[cleanIndustry];
          newItem.code = code;
          updatedCount++;
          console.log(`✓ 为行业 "${item.industry}" 设置编号 "${code}"`);
        } else {
          console.log(`✗ 行业 "${item.industry}" 没有找到对应编号 (尝试了 "${cleanIndustry}" 和 "${item.industry}")`);
        }
        return newItem;
      });
    });

    console.log(`刷新完成，共更新了 ${updatedCount} 条数据的编号`);

    // 保存更新后的数据
    if (fs && dataFile) {
      fs.writeFileSync(dataFile, JSON.stringify(updatedDataByDate, null, 2), 'utf-8');
    }
    
    setDataByDate(updatedDataByDate);
    message.success(`刷新完成，更新了 ${updatedCount} 条数据的编号`);
  };

  return (
    <div>
      {/* 调试信息 */}
      <div style={{ marginBottom: 16, padding: 8, backgroundColor: '#f0f0f0', fontSize: '12px' }}>
        当前日期数量: {dates.length}, 日期列表: {dates.join(', ')}
        <br />
        行业编号映射数量: {Object.keys(industryCodeMap).length}
        <br />
        行业编号映射: {JSON.stringify(industryCodeMap)}
      </div>
      
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={handleBatchExport} style={{ marginRight: 8 }}>
          批量导出所有日期
        </Button>
        <Button type="danger" onClick={handleClearData}>
          清空本地数据
        </Button>
      </div>
      <div style={{ marginBottom: 16 }}>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          id="upload-input"
          onChange={handleUpload}
        />
        <Button type="dashed" onClick={() => document.getElementById('upload-input').click()}>
          上传数据表
        </Button>
      </div>
      <div style={{ marginBottom: 16 }}>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          id="code-upload-input"
          onChange={handleCodeUpload}
        />
        <Button type="dashed" onClick={() => document.getElementById('code-upload-input').click()}>
          上传编号表
        </Button>
        <Button 
          type="primary" 
          onClick={handleRefreshCodes} 
          style={{ marginLeft: 8 }}
          disabled={Object.keys(industryCodeMap).length === 0}
        >
          刷新编号
        </Button>
      </div>
      <List
        bordered
        dataSource={dates}
        renderItem={date => (
          <List.Item
            style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/result/${date}`)}
          >
            {date}
          </List.Item>
        )}
        locale={{ emptyText: '暂无数据' }}
      />
    </div>
  );
} 