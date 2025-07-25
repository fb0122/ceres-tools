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

  return (
    <div>
      <Button type="primary" onClick={handleBatchExport} style={{ marginBottom: 16 }}>批量导出所有日期</Button>
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