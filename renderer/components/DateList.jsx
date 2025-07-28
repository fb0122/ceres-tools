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
  const navigate = useNavigate();

  useEffect(() => {
    if (electron && electron.ipcRenderer) {
      electron.ipcRenderer.invoke('get-user-data-path').then((p) => {
        setUserDataPath(p);
        setDataFile(path ? path.join(p, 'data.json') : '');
        if (fs && path) {
          const filePath = path.join(p, 'data.json');
          if (fs.existsSync(filePath)) {
            try {
              const raw = fs.readFileSync(filePath, 'utf-8');
              const local = JSON.parse(raw);
              setDataByDate(local);
              setDates(Object.keys(local));
            } catch {
              setDataByDate({});
              setDates([]);
            }
          }
        }
      });
    }
  }, []);

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
        const { industry, amount } = row;
        if (!industryMap[industry]) {
          industryMap[industry] = { industry, count: 0, total: 0 };
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
        '行业': row.industry,
        '股票数量': row.count,
        '成交总额（亿）': row.total,
        '日期': row.date,
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
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
      // 合并数据
      const newDataByDate = { ...dataByDate };
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

        if (!newDataByDate[date]) newDataByDate[date] = [];
        newDataByDate[date].push({ 
          industry, 
          rawAmount: amount,  // 保存原始金额字符串
          amount: parsedAmount  // 保存转换后的金额（亿）
        });
      });
      // 保存到本地
      if (fs && dataFile) {
        fs.writeFileSync(dataFile, JSON.stringify(newDataByDate, null, 2), 'utf-8');
      }
      setDataByDate(newDataByDate);
      setDates(Object.keys(newDataByDate));
      message.success('上传并保存成功');
    } catch (err) {
      message.error('文件解析失败');
      console.error('解析文件出错:', err);
    }
  };

  return (
    <div>
      <Button type="primary" onClick={handleBatchExport} style={{ marginBottom: 16 }}>批量导出所有日期</Button>
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