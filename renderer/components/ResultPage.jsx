import React, { useEffect, useState } from 'react';
import { Table, Button, message } from 'antd';
import { useParams, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';

const fs = window.require ? window.require('fs') : null;
const path = window.require ? window.require('path') : null;
const electron = window.require ? window.require('electron') : null;

const columns = [
  { title: '行业编号', dataIndex: 'code', key: 'code' },
  { title: '行业', dataIndex: 'industry', key: 'industry' },
  { title: '股票数量', dataIndex: 'count', key: 'count' },
  { title: '成交总额（亿）', dataIndex: 'total', key: 'total' },
  { title: '日期', dataIndex: 'date', key: 'date' },
];

export default function ResultPage() {
  const { date } = useParams();
  const navigate = useNavigate();
  const [dataByDate, setDataByDate] = useState({});
  const [tableData, setTableData] = useState([]);
  const [userDataPath, setUserDataPath] = useState('');
  const [dataFile, setDataFile] = useState('');
  const [industryCodeMap, setIndustryCodeMap] = useState({}); // 行业编号映射

  useEffect(() => {
    if (electron && electron.ipcRenderer) {
      electron.ipcRenderer.invoke('get-user-data-path').then((p) => {
        setUserDataPath(p);
        setDataFile(path ? path.join(p, 'data.json') : '');
        
        if (fs && path) {
          // 加载数据文件
          const filePath = path.join(p, 'data.json');
          if (fs.existsSync(filePath)) {
            try {
              const raw = fs.readFileSync(filePath, 'utf-8');
              const local = JSON.parse(raw);
              setDataByDate(local);
              
              // 加载行业编号映射文件
              const codeMapPath = path.join(p, 'industry_codes.json');
              console.log('详情页 - 尝试加载行业编号映射文件:', codeMapPath);
              if (fs.existsSync(codeMapPath)) {
                try {
                  const codeRaw = fs.readFileSync(codeMapPath, 'utf-8');
                  const codes = JSON.parse(codeRaw);
                  setIndustryCodeMap(codes);
                  console.log('详情页 - 成功加载行业编号映射:', codes);
                } catch (err) {
                  console.log('详情页 - 加载行业编号映射失败:', err);
                  setIndustryCodeMap({});
                }
              } else {
                console.log('详情页 - 行业编号映射文件不存在');
                setIndustryCodeMap({});
              }
              
              if (local[date]) {
                console.log('详情页 - 原始数据:', local[date]);
              } else {
                setTableData([]);
              }
            } catch {
              setDataByDate({});
              setTableData([]);
            }
          }
        }
      });
    }
  }, [date]);

  // 数据聚合处理
  useEffect(() => {
    console.log('详情页 - 数据聚合 useEffect 触发，状态检查:', {
      hasDataByDate: !!dataByDate,
      hasDateData: !!(dataByDate && dataByDate[date]),
      hasIndustryCodeMap: !!industryCodeMap,
      industryCodeMapKeys: industryCodeMap ? Object.keys(industryCodeMap) : [],
      industryCodeMapSize: industryCodeMap ? Object.keys(industryCodeMap).length : 0
    });
    
    if (dataByDate && dataByDate[date] && industryCodeMap) {
      console.log('详情页 - 开始数据聚合处理');
      
      // 按行业聚合，计算每个行业的成交总额（亿）
      const industryMap = {};
      
      function parseAmount(val) {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        
        let str = String(val).replace(/,/g, '').replace(/\s/g, '').trim();
        
        // 1. 判断单位
        let unit = '元';  // 默认单位为元
        if (str.includes('亿')) unit = '亿';
        else if (str.includes('万')) unit = '万';
        
        // 2. 提取纯数字部分
        let numStr = str.replace(/[^\d.]/g, '');
        let num = parseFloat(numStr);
        
        // 3. 根据单位转换为亿
        let result = 0;
        if (!isNaN(num)) {
          switch (unit) {
            case '亿':
              result = num;
              break;
            case '万':
              result = num / 10000;
              break;
            case '元':
              result = num / 1e8;
              break;
          }
        }
        
        // 打印调试信息
        console.log('详情页 - 原始金额:', val, '单位:', unit, '数值:', num, '转换后（亿）:', result);
        
        return result;
      }
      
      // 遍历数据，按行业聚合
      console.log('详情页 - 开始处理数据，当前行业编号映射:', industryCodeMap);
      console.log('详情页 - 处理日期数据:', date, '数据条数:', dataByDate[date].length);
      
      // 检查是否有重复数据
      const uniqueIndustries = new Set();
      const industryCounts = {};
      const industryDetails = {};
      
      dataByDate[date].forEach((row, index) => {
        const { industry, rawAmount } = row;
        uniqueIndustries.add(industry);
        industryCounts[industry] = (industryCounts[industry] || 0) + 1;
        
        // 记录每个行业的详细信息
        if (!industryDetails[industry]) {
          industryDetails[industry] = [];
        }
        industryDetails[industry].push({
          index: index + 1,
          rawAmount: rawAmount
        });
      });
      
      console.log('详情页 - 唯一行业数量:', uniqueIndustries.size);
      console.log('详情页 - 各行业数据条数:', industryCounts);
      
      // 详细分析半导体行业的数据
      if (industryDetails['  半导体']) {
        console.log('详情页 - 半导体行业详细数据:', industryDetails['  半导体']);
        console.log('详情页 - 半导体行业数据条数:', industryDetails['  半导体'].length);
      }
      
      // 处理所有数据，不再限制数据量
      console.log('详情页 - 处理所有数据，数据条数:', dataByDate[date].length);
      
      dataByDate[date].forEach((row, index) => {
        const { industry, amount, rawAmount, code } = row;
        
        console.log(`详情页 - 处理第${index + 1}行数据:`, { industry, code, industryCodeMap: industryCodeMap[industry] });
        
        // 初始化行业数据
        if (!industryMap[industry]) {
          const cleanIndustry = industry.trim();
          const finalCode = code || industryCodeMap[industry] || industryCodeMap[cleanIndustry] || '';
          industryMap[industry] = { 
            industry, 
            code: finalCode, // 使用行中的编号或映射中的编号
            count: 0,  // 股票数量
            total: 0,  // 成交总额（亿）
            details: []  // 调试用：记录每只股票的金额
          };
          console.log(`详情页 - 初始化行业 "${industry}" 编号为 "${finalCode}" (尝试了 "${cleanIndustry}" 和 "${industry}")`);
        }
        
        // 计数
        industryMap[industry].count += 1;
        
        // 优先使用已解析的 amount，如果为 0 则重新解析 rawAmount
        let val = (typeof amount === 'number' && amount > 0) ? amount : parseAmount(rawAmount);
        
        // 累加到行业总额
        industryMap[industry].total += val;
        
        // 记录调试信息
        industryMap[industry].details.push({
          rawAmount,
          parsedAmount: val
        });
      });
      
      // 转换为表格数据并按编号排序
      const result = Object.values(industryMap)
        .map(item => {
          // 打印每个行业的详细信息
          console.log('行业聚合 -', item.industry, {
            行业编号: item.code,
            股票数: item.count,
            成交总额: item.total.toFixed(2),
            明细: item.details
          });
          
          return {
            industry: item.industry,
            code: item.code,
            count: item.count,
            total: item.total.toFixed(2),
            date: date
          };
        })
        .sort((a, b) => {
          // 按编号排序，如果编号为空则排在最后
          if (!a.code && !b.code) return 0;
          if (!a.code) return 1;
          if (!b.code) return -1;
          
          // 尝试按数字排序，如果失败则按字符串排序
          const aNum = parseInt(a.code);
          const bNum = parseInt(b.code);
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return aNum - bNum;
          }
          return a.code.localeCompare(b.code);
        });
      
      setTableData(result);
    }
  }, [dataByDate, date, industryCodeMap]);

  // 导出当前详情页聚合数据
  const handleExport = () => {
    if (!tableData.length) return message.warning('无数据可导出');
    // 表头和数据与页面一致
    const exportData = tableData.map(row => ({
      '行业编号': row.code,
      '行业': row.industry,
      '股票数量': row.count,
      '成交总额（亿）': row.total,
      '日期': row.date,
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, date);
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    if (electron && electron.remote) {
      electron.remote.dialog.showSaveDialog({
        defaultPath: `${date}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      }).then(({ filePath }) => {
        if (filePath && fs) {
          fs.writeFileSync(filePath, Buffer.from(buf));
          message.success('导出成功');
        }
      });
    } else {
      // fallback: 浏览器下载
      const blob = new Blob([buf], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button onClick={() => navigate('/')}>返回</Button>
        <b style={{ marginLeft: 16 }}>当前数据日期：</b>{date}
        <Button style={{ marginLeft: 16 }} onClick={handleExport}>导出为Excel</Button>
      </div>
      <Table
        columns={columns}
        dataSource={tableData}
        rowKey={row => row.industry + row.date}
        pagination={false}
        locale={{ emptyText: '暂无数据' }}
      />
    </div>
  );
} 